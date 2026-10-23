//! ConstantUnits bill mandates (D-085).
//!
//! A mandate lets ConstantUnits take up to `cap` of one token from the owner's account per `period` seconds, for one
//! bill, until `end`. The owner signs once, when the mandate is created; after that the operator charges it when the
//! bill is due and the token goes straight to the treasury. Nothing else can be taken:
//!
//! - the cap per period is enforced here, not by the operator's database;
//! - every charge carries a 32-byte id (the order id) and the same id never charges twice;
//! - the owner can revoke at any time, which also lowers the token allowance they gave this contract;
//! - the token allowance itself is the sum of what live mandates may still take, so even this contract can never
//!   move more than the owner agreed to.
//!
//! The operator (admin) pays every fee: the owner's only action is a signature.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, ContractExecutable, Env,
};

/// Ledgers in a day at about five seconds a ledger.
const DAY_LEDGERS: u32 = 17_280;
/// Keep the contract and live mandates for at least 30 days past their last use, topped up to 120.
const BUMP_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const BUMP_TO: u32 = 120 * DAY_LEDGERS;
/// A charge id is remembered for 30 days: far longer than any retry.
const CHARGE_TTL: u32 = 30 * DAY_LEDGERS;
/// The shortest period: one day. Bills renew daily at the most.
const MIN_PERIOD: u64 = 86_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    MandateExists = 1,
    MandateNotFound = 2,
    InvalidAmount = 3,
    InvalidPeriod = 4,
    Revoked = 5,
    Expired = 6,
    OverCap = 7,
    DuplicateCharge = 8,
    NotAllowed = 9,
    BadExpiry = 10,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mandate {
    pub owner: Address,
    /// Most that may be charged in one period, in the token's smallest unit.
    pub cap: i128,
    /// Length of a period in seconds.
    pub period: u64,
    /// Ledger time the mandate was created; periods count from here.
    pub start: u64,
    /// No charge at or after this ledger time.
    pub end: u64,
    /// Number of periods between start and end (the last may be partial).
    pub periods: u64,
    /// The period `spent` belongs to.
    pub period_index: u64,
    /// Charged in that period.
    pub spent: i128,
    /// Charged over the mandate's life.
    pub total_spent: i128,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Admin,
    Treasury,
    Token,
    Mandate(BytesN<32>),
    Charge(BytesN<32>),
    /// What the owner's live mandates may still take, all together: the token allowance this contract asks for.
    Outstanding(Address),
    /// The ledger the owner's allowance to this contract expires at.
    Expiry(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created {
    #[topic]
    pub id: BytesN<32>,
    #[topic]
    pub owner: Address,
    pub cap: i128,
    pub period: u64,
    pub end: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Charged {
    #[topic]
    pub id: BytesN<32>,
    pub charge_id: BytesN<32>,
    pub amount: i128,
    pub period_index: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Revoked {
    #[topic]
    pub id: BytesN<32>,
    pub by: Address,
}

#[contract]
pub struct MandateContract;

#[contractimpl]
impl MandateContract {
    /// Set once, at deploy: the operator that charges, where charged tokens go, and the one token mandates are in.
    pub fn __constructor(env: Env, admin: Address, treasury: Address, token: Address) {
        let s = env.storage().instance();
        s.set(&Key::Admin, &admin);
        s.set(&Key::Treasury, &treasury);
        s.set(&Key::Token, &token);
    }

    /// The owner allows up to `cap` per `period` seconds until `end` (ledger time). Signed by the owner; the token
    /// allowance to this contract grows by what the new mandate may take over its life, and lasts until
    /// `expiry_ledger` (or the owner's existing expiry, if later). Every argument of the inner token approve comes
    /// from these arguments and stored state, never from the current ledger, so the owner's signature still matches
    /// when the transaction lands a few ledgers after it was simulated.
    pub fn create(
        env: Env,
        owner: Address,
        id: BytesN<32>,
        cap: i128,
        period: u64,
        end: u64,
        expiry_ledger: u32,
    ) {
        owner.require_auth();
        bump_instance(&env);
        if cap <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let now = env.ledger().timestamp();
        if period < MIN_PERIOD || end <= now {
            panic_with_error!(&env, Error::InvalidPeriod);
        }
        let seq = env.ledger().sequence();
        if expiry_ledger < seq || expiry_ledger > seq + env.storage().max_ttl() - 1 {
            panic_with_error!(&env, Error::BadExpiry);
        }
        let key = Key::Mandate(id.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::MandateExists);
        }
        let periods = (end - now).div_ceil(period);
        let entitlement = cap
            .checked_mul(periods as i128)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount));
        let m = Mandate {
            owner: owner.clone(),
            cap,
            period,
            start: now,
            end,
            periods,
            period_index: 0,
            spent: 0,
            total_spent: 0,
            revoked: false,
        };
        env.storage().persistent().set(&key, &m);
        bump(&env, &key);
        let outstanding = outstanding_of(&env, &owner) + entitlement;
        set_outstanding(&env, &owner, outstanding);
        let expiry = expiry_of(&env, &owner).max(expiry_ledger);
        set_expiry(&env, &owner, expiry);
        approve(&env, &owner, outstanding, expiry);
        Created {
            id,
            owner,
            cap,
            period,
            end,
        }
        .publish(&env);
    }

    /// Takes `amount` for the bill. Only the operator; within the cap for the current period; once per `charge_id`.
    pub fn charge(env: Env, id: BytesN<32>, charge_id: BytesN<32>, amount: i128) {
        let admin = admin(&env);
        admin.require_auth();
        bump_instance(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let charge_key = Key::Charge(charge_id.clone());
        if env.storage().temporary().has(&charge_key) {
            panic_with_error!(&env, Error::DuplicateCharge);
        }
        let key = Key::Mandate(id.clone());
        let mut m = load(&env, &key);
        if m.revoked {
            panic_with_error!(&env, Error::Revoked);
        }
        let now = env.ledger().timestamp();
        if now >= m.end {
            panic_with_error!(&env, Error::Expired);
        }
        roll(&mut m, now);
        if m.spent + amount > m.cap {
            panic_with_error!(&env, Error::OverCap);
        }
        m.spent += amount;
        m.total_spent += amount;
        env.storage().persistent().set(&key, &m);
        bump(&env, &key);
        env.storage().temporary().set(&charge_key, &true);
        env.storage()
            .temporary()
            .extend_ttl(&charge_key, CHARGE_TTL, CHARGE_TTL);
        set_outstanding(
            &env,
            &m.owner,
            (outstanding_of(&env, &m.owner) - amount).max(0),
        );

        let me = env.current_contract_address();
        token::Client::new(&env, &token_of(&env)).transfer_from(
            &me,
            &m.owner,
            &treasury(&env),
            &amount,
        );
        Charged {
            id,
            charge_id,
            amount,
            period_index: m.period_index,
        }
        .publish(&env);
    }

    /// Stops the mandate for good. By the owner (which also lowers the token allowance) or by the operator.
    pub fn revoke(env: Env, caller: Address, id: BytesN<32>) {
        caller.require_auth();
        bump_instance(&env);
        let key = Key::Mandate(id.clone());
        let mut m = load(&env, &key);
        let is_owner = caller == m.owner;
        if !is_owner && caller != admin(&env) {
            panic_with_error!(&env, Error::NotAllowed);
        }
        if m.revoked {
            panic_with_error!(&env, Error::Revoked);
        }
        m.revoked = true;
        env.storage().persistent().set(&key, &m);
        bump(&env, &key);
        let unused = (m.cap * m.periods as i128 - m.total_spent).max(0);
        let outstanding = (outstanding_of(&env, &m.owner) - unused).max(0);
        set_outstanding(&env, &m.owner, outstanding);
        let expiry = expiry_of(&env, &m.owner);
        // Lower the allowance to what the owner's other mandates still need. An allowance already past its expiry is
        // gone anyway (and the token refuses a past expiry for a non-zero amount).
        if is_owner && (outstanding == 0 || expiry >= env.ledger().sequence()) {
            approve(&env, &m.owner, outstanding, expiry);
        }
        Revoked { id, by: caller }.publish(&env);
    }

    pub fn get(env: Env, id: BytesN<32>) -> Mandate {
        let mut m = load(&env, &Key::Mandate(id));
        let at = env.ledger().timestamp().min(m.end.saturating_sub(1));
        roll(&mut m, at);
        m
    }

    /// What can be charged right now: zero if revoked or ended, else what's left of this period's cap, never more
    /// than the token allowance still in place.
    pub fn remaining(env: Env, id: BytesN<32>) -> i128 {
        let mut m = load(&env, &Key::Mandate(id));
        let now = env.ledger().timestamp();
        if m.revoked || now >= m.end {
            return 0;
        }
        roll(&mut m, now);
        let allowance = token::Client::new(&env, &token_of(&env))
            .allowance(&m.owner, &env.current_contract_address());
        (m.cap - m.spent).min(allowance).max(0)
    }

    pub fn outstanding(env: Env, owner: Address) -> i128 {
        outstanding_of(&env, &owner)
    }

    pub fn admin(env: Env) -> Address {
        admin(&env)
    }

    pub fn treasury(env: Env) -> Address {
        treasury(&env)
    }

    pub fn token(env: Env) -> Address {
        token_of(&env)
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        admin(&env).require_auth();
        env.storage().instance().set(&Key::Admin, &new_admin);
    }

    pub fn set_treasury(env: Env, new_treasury: Address) {
        admin(&env).require_auth();
        env.storage().instance().set(&Key::Treasury, &new_treasury);
    }

    /// Replaces the contract code. Stored mandates and their caps carry over unchanged.
    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        admin(&env).require_auth();
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(wasm_hash));
    }
}

/// Moves `m` to the period `now` falls in, starting that period's spend at zero.
fn roll(m: &mut Mandate, now: u64) {
    let index = now.saturating_sub(m.start) / m.period;
    if index != m.period_index {
        m.period_index = index;
        m.spent = 0;
    }
}

fn approve(env: &Env, owner: &Address, amount: i128, expiry: u32) {
    token::Client::new(env, &token_of(env)).approve(
        owner,
        &env.current_contract_address(),
        &amount,
        &expiry,
    );
}

fn expiry_of(env: &Env, owner: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&Key::Expiry(owner.clone()))
        .unwrap_or(0)
}

fn set_expiry(env: &Env, owner: &Address, ledger: u32) {
    let key = Key::Expiry(owner.clone());
    env.storage().persistent().set(&key, &ledger);
    bump(env, &key);
}

fn load(env: &Env, key: &Key) -> Mandate {
    env.storage()
        .persistent()
        .get(key)
        .unwrap_or_else(|| panic_with_error!(env, Error::MandateNotFound))
}

fn outstanding_of(env: &Env, owner: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&Key::Outstanding(owner.clone()))
        .unwrap_or(0)
}

fn set_outstanding(env: &Env, owner: &Address, amount: i128) {
    let key = Key::Outstanding(owner.clone());
    env.storage().persistent().set(&key, &amount);
    bump(env, &key);
}

fn admin(env: &Env) -> Address {
    env.storage().instance().get(&Key::Admin).unwrap()
}

fn treasury(env: &Env) -> Address {
    env.storage().instance().get(&Key::Treasury).unwrap()
}

fn token_of(env: &Env) -> Address {
    env.storage().instance().get(&Key::Token).unwrap()
}

fn bump(env: &Env, key: &Key) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

#[cfg(test)]
mod test;
