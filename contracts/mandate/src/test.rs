extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger};
use soroban_sdk::{token::StellarAssetClient, token::TokenClient, Symbol};

const DAY: u64 = 86_400;
const MONTH: u64 = 30 * DAY;
const T0: u64 = 1_800_000_000;
/// Allowance expiry used by the tests: well inside the network's limit from ledger 1,000.
const EXPIRY: u32 = 1_000 + 2_000_000;

struct Setup {
    env: Env,
    client: MandateContractClient<'static>,
    admin: Address,
    treasury: Address,
    owner: Address,
    token: TokenClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.timestamp = T0;
        l.sequence_number = 1_000;
    });
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &sac.address()).mint(&owner, &1_000_0000000);
    let id = env.register(
        MandateContract,
        (admin.clone(), treasury.clone(), sac.address()),
    );
    let client = MandateContractClient::new(&env, &id);
    let token = TokenClient::new(&env, &sac.address());
    Setup {
        env,
        client,
        admin,
        treasury,
        owner,
        token,
    }
}

/// The call failed with this contract error.
fn fails<T: core::fmt::Debug, E: core::fmt::Debug>(
    res: Result<T, Result<soroban_sdk::Error, E>>,
    want: Error,
) {
    match res {
        Err(Ok(got)) => assert_eq!(got, soroban_sdk::Error::from_contract_error(want as u32)),
        other => panic!("expected {:?}, got {:?}", want, other),
    }
}

fn id(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| {
        l.timestamp += secs;
        l.sequence_number += (secs / 5) as u32;
    });
}

/// 10 units a month for six months.
fn create_monthly(s: &Setup, n: u8) -> BytesN<32> {
    let m = id(&s.env, n);
    s.client.create(
        &s.owner,
        &m,
        &10_0000000,
        &MONTH,
        &(T0 + 6 * MONTH),
        &EXPIRY,
    );
    m
}

#[test]
fn create_asks_the_owner_and_approves_the_whole_life_of_the_mandate() {
    let s = setup();
    let m = create_monthly(&s, 1);
    // The owner signed create, and inside it the token approve: nothing else.
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.owner);
    let AuthorizedInvocation {
        function,
        sub_invocations,
    } = &auths[0].1;
    match function {
        AuthorizedFunction::Contract((contract, name, _)) => {
            assert_eq!(*contract, s.client.address);
            assert_eq!(*name, Symbol::new(&s.env, "create"));
        }
        _ => panic!("expected a contract call"),
    }
    assert_eq!(sub_invocations.len(), 1);
    assert_eq!(s.token.allowance(&s.owner, &s.client.address), 60_0000000);
    assert_eq!(s.client.outstanding(&s.owner), 60_0000000);
    assert_eq!(s.client.remaining(&m), 10_0000000);
    let got = s.client.get(&m);
    assert_eq!(got.periods, 6);
    assert!(!got.revoked);
}

#[test]
fn charge_moves_tokens_to_the_treasury_within_the_cap() {
    let s = setup();
    let m = create_monthly(&s, 1);
    s.client.charge(&m, &id(&s.env, 100), &4_0000000);
    assert_eq!(s.token.balance(&s.treasury), 4_0000000);
    assert_eq!(s.token.balance(&s.owner), 996_0000000);
    assert_eq!(s.client.remaining(&m), 6_0000000);
    s.client.charge(&m, &id(&s.env, 101), &6_0000000);
    assert_eq!(s.client.remaining(&m), 0);
    fails(
        s.client.try_charge(&m, &id(&s.env, 102), &1),
        Error::OverCap,
    );
    assert_eq!(s.token.balance(&s.treasury), 10_0000000);
}

#[test]
fn only_the_operator_can_charge() {
    let s = setup();
    let m = create_monthly(&s, 1);
    s.client.charge(&m, &id(&s.env, 100), &1);
    let auths = s.env.auths();
    assert_eq!(auths[0].0, s.admin);
}

#[test]
#[should_panic]
fn a_charge_without_the_operators_signature_fails() {
    let s = setup();
    let m = create_monthly(&s, 1);
    s.env.set_auths(&[]);
    s.client.charge(&m, &id(&s.env, 100), &1);
}

#[test]
fn a_charge_id_never_charges_twice() {
    let s = setup();
    let m = create_monthly(&s, 1);
    s.client.charge(&m, &id(&s.env, 100), &1_0000000);
    fails(
        s.client.try_charge(&m, &id(&s.env, 100), &1_0000000),
        Error::DuplicateCharge,
    );
    assert_eq!(s.token.balance(&s.treasury), 1_0000000);
}

#[test]
fn the_cap_resets_each_period_and_ends_at_the_end() {
    let s = setup();
    let m = create_monthly(&s, 1);
    s.client.charge(&m, &id(&s.env, 1), &10_0000000);
    fails(s.client.try_charge(&m, &id(&s.env, 2), &1), Error::OverCap);
    advance(&s.env, MONTH);
    assert_eq!(s.client.remaining(&m), 10_0000000);
    s.client.charge(&m, &id(&s.env, 3), &10_0000000);
    assert_eq!(s.client.get(&m).period_index, 1);
    advance(&s.env, 5 * MONTH);
    assert_eq!(s.client.remaining(&m), 0);
    fails(s.client.try_charge(&m, &id(&s.env, 4), &1), Error::Expired);
}

#[test]
fn an_unused_period_does_not_roll_over() {
    let s = setup();
    let m = create_monthly(&s, 1);
    advance(&s.env, 2 * MONTH);
    fails(
        s.client.try_charge(&m, &id(&s.env, 1), &20_0000000),
        Error::OverCap,
    );
}

#[test]
fn the_owner_can_revoke_and_the_allowance_drops() {
    let s = setup();
    let m = create_monthly(&s, 1);
    s.client.charge(&m, &id(&s.env, 1), &3_0000000);
    s.client.revoke(&s.owner, &m);
    assert_eq!(s.client.remaining(&m), 0);
    assert_eq!(s.client.outstanding(&s.owner), 0);
    assert_eq!(s.token.allowance(&s.owner, &s.client.address), 0);
    fails(s.client.try_charge(&m, &id(&s.env, 2), &1), Error::Revoked);
    fails(s.client.try_revoke(&s.owner, &m), Error::Revoked);
}

#[test]
fn the_operator_can_revoke_but_a_stranger_cannot() {
    let s = setup();
    let m = create_monthly(&s, 1);
    let stranger = Address::generate(&s.env);
    fails(s.client.try_revoke(&stranger, &m), Error::NotAllowed);
    s.client.revoke(&s.admin, &m);
    assert!(s.client.get(&m).revoked);
}

#[test]
fn mandates_for_several_bills_share_one_allowance_without_overwriting_it() {
    let s = setup();
    let data = create_monthly(&s, 1);
    let tv = id(&s.env, 2);
    s.client.create(
        &s.owner,
        &tv,
        &20_0000000,
        &MONTH,
        &(T0 + 3 * MONTH),
        &EXPIRY,
    );
    assert_eq!(
        s.token.allowance(&s.owner, &s.client.address),
        60_0000000 + 60_0000000
    );
    s.client.charge(&tv, &id(&s.env, 10), &20_0000000);
    s.client.charge(&data, &id(&s.env, 11), &10_0000000);
    assert_eq!(s.token.allowance(&s.owner, &s.client.address), 90_0000000);
    assert_eq!(s.client.outstanding(&s.owner), 90_0000000);
    // Revoking one leaves the other's allowance in place.
    s.client.revoke(&s.owner, &tv);
    assert_eq!(s.token.allowance(&s.owner, &s.client.address), 50_0000000);
    assert_eq!(s.client.remaining(&data), 0);
    advance(&s.env, MONTH);
    s.client.charge(&data, &id(&s.env, 12), &10_0000000);
}

#[test]
fn remaining_is_never_more_than_the_allowance_left() {
    let s = setup();
    let m = create_monthly(&s, 1);
    // The owner lowers the allowance from their own wallet, outside ConstantUnits.
    let exp = s.env.ledger().sequence() + 1_000;
    s.token
        .approve(&s.owner, &s.client.address, &2_0000000, &exp);
    assert_eq!(s.client.remaining(&m), 2_0000000);
    assert!(s.client.try_charge(&m, &id(&s.env, 1), &3_0000000).is_err());
}

#[test]
fn the_allowance_expiry_comes_from_the_arguments_and_never_shrinks() {
    let s = setup();
    create_monthly(&s, 1);
    let tv = id(&s.env, 2);
    // A later mandate asking for an earlier expiry keeps the owner's later one.
    s.client.create(
        &s.owner,
        &tv,
        &1_0000000,
        &MONTH,
        &(T0 + MONTH),
        &(EXPIRY - 10),
    );
    advance(&s.env, 10 * DAY);
    s.client.charge(&tv, &id(&s.env, 1), &1_0000000);
    assert_eq!(s.token.allowance(&s.owner, &s.client.address), 60_0000000);
}

#[test]
fn bad_inputs_are_refused() {
    let s = setup();
    let m = id(&s.env, 1);
    fails(
        s.client
            .try_create(&s.owner, &m, &0, &MONTH, &(T0 + MONTH), &EXPIRY),
        Error::InvalidAmount,
    );
    fails(
        s.client
            .try_create(&s.owner, &m, &1, &60, &(T0 + MONTH), &EXPIRY),
        Error::InvalidPeriod,
    );
    fails(
        s.client.try_create(&s.owner, &m, &1, &MONTH, &T0, &EXPIRY),
        Error::InvalidPeriod,
    );
    fails(
        s.client
            .try_create(&s.owner, &m, &1, &MONTH, &(T0 + MONTH), &999),
        Error::BadExpiry,
    );
    fails(
        s.client.try_create(
            &s.owner,
            &m,
            &1,
            &MONTH,
            &(T0 + MONTH),
            &(1_000 + 500 * 17_280 * 30),
        ),
        Error::BadExpiry,
    );
    create_monthly(&s, 1);
    fails(
        s.client
            .try_create(&s.owner, &m, &1, &MONTH, &(T0 + MONTH), &EXPIRY),
        Error::MandateExists,
    );
    fails(
        s.client.try_charge(&id(&s.env, 9), &id(&s.env, 1), &1),
        Error::MandateNotFound,
    );
    fails(
        s.client.try_charge(&m, &id(&s.env, 1), &0),
        Error::InvalidAmount,
    );
}

#[test]
fn admin_and_treasury_can_change_only_with_the_admin() {
    let s = setup();
    let new_treasury = Address::generate(&s.env);
    s.client.set_treasury(&new_treasury);
    assert_eq!(s.env.auths()[0].0, s.admin);
    let m = create_monthly(&s, 1);
    s.client.charge(&m, &id(&s.env, 1), &1_0000000);
    assert_eq!(s.token.balance(&new_treasury), 1_0000000);
    let new_admin = Address::generate(&s.env);
    s.client.set_admin(&new_admin);
    assert_eq!(s.client.admin(), new_admin);
}
