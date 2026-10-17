# ConstantUnits brand files

Ready to upload, in `out/`:

| File | Size | Use |
|---|---|---|
| `x-profile-400.png` | 400 × 400 | X profile photo (X shows it as a circle; the mark sits well inside it) |
| `x-profile-400-light.png` | 400 × 400 | Same, light version |
| `x-header-1500x500.png` | 1500 × 500 | X header. Text sits in the lower band, right of the profile photo: the X phone app lays its buttons across the middle of the header |
| `icon-1024.png` | 1024 × 1024 | Square icon for other profiles (LinkedIn, Instagram, app stores later) |
| `logo-dark-2400x600.png` | 2400 × 600, transparent | Logo with the name, for light backgrounds |
| `logo-light-2400x600.png` | 2400 × 600, transparent | Logo with the name, for dark backgrounds |

The mark is the same as the website's (`apps/web/components/Logo.tsx`): a "C" with a level line through it, the
level that never drops. Type: Inter Tight and Instrument Serif italic, as on the site (both under the SIL Open Font
License, in `fonts/`). Black #0a0a0a and off-white #fafafa only.

To change something, edit `src/*.html` and run `node brand/render.mjs` (uses Playwright's Chromium).
