# Checkout UI Audit

Date: 7 June 2026

Branch: `hras-checkout-ux-port`

## Scope

This audit covers the public HR Analytics Summit checkout only. It does not change API, database,
pricing, VAT, discount, promo, Stripe, booking or attendee business logic.

## Baseline Findings

1. The header only shows a thin progress bar and a desktop-only step sentence. Mobile users do not
   receive labelled progress or completed, current and upcoming states.
2. Global CSS forces buttons into pill shapes and form fields into square corners, which conflicts
   with the HRAS 6px radius standard.
3. Step 2 includes animated promotional decoration and an additional orange gradient accent that
   competes with the HRAS primary colour.
4. Quantity increment and decrement controls do not have accessible names.
5. Step 3 attendee cards show useful content but their ready, TBC and pending states are not visually
   distinct enough when the accordion is collapsed.
6. Step 4 repeats invoice guidance across five-step panels and supporting text, increasing scanning
   effort.
7. Confirmation calls string methods directly on attendee names. A TBC attendee with null name
   fields can therefore crash the page.

## Screenshot Index

Numbered before and after screenshots are stored beside this file.

1. `01-before-step2-desktop.png`: Step 2 desktop baseline.
2. `02-before-step3-mobile.png`: Step 3 narrow viewport baseline.
3. `03-before-step4-card-desktop.png`: Step 4 card route desktop baseline.
4. `04-before-confirmation-desktop.png`: Confirmation desktop baseline.
5. `05-after-step2-desktop.png`: Step 2 group booking with labelled progress and selected pass.
6. `06-after-step3-mobile.png`: Step 3 at 390px with labelled progress and attendee states.
7. `07-after-step4-invoice-desktop.png`: Step 4 invoice route with three-step guidance.
8. `08-after-confirmation-tbc-desktop.png`: Confirmation with a null-name TBC attendee.
9. `09-after-step4-card-mobile.png`: Step 4 card route at 390px.
10. `10-after-step2-vendor-desktop.png`: Vendor Business Pass state.
11. `11-after-step2-single-desktop.png`: Single HR ticket state.
12. `12-after-step1-validation-mobile.png`: Required-field validation at 390px.

## Changes Verified

1. Desktop and mobile now show all four labelled steps with completed, current and upcoming states.
2. Checkout cards, fields and actions use the HRAS 6px radius with restrained borders and shadows.
3. Step 1 and Step 4 selected options have explicit labels, radio states, borders and backgrounds.
4. Step 2 no longer uses the orange gradient shortcut or animated promotional decoration.
5. Quantity decrement and increment buttons have accessible names.
6. Step 3 collapsed attendee cards show Ready, TBC or Needs details.
7. Step 4 invoice guidance is presented as three concise steps with optional detail disclosure.
8. Card and invoice payment choices remain separate and clear.
9. A TBC attendee with null name fields renders as `Attendee 3 (TBC)` without a runtime exception.
10. Validation messages remain visible and associated with the affected fields.

## Test Matrix

- HR Professional, one ticket: rendered.
- HR Professional, group booking: rendered.
- Consultant or vendor Business Pass: rendered.
- TBC attendee with null names: rendered and covered by a focused unit test.
- Card payment route: rendered on desktop and 390px mobile.
- Invoice payment route: rendered on desktop.
- Required-field validation: triggered and rendered on 390px mobile.
- Confirmation: rendered with invoice and TBC states.

The in-app Browser runtime was unavailable in this desktop session, so screenshots were captured
through local Chrome DevTools with exact viewport emulation. The capture script reports runtime
exceptions and none were found in the final states.
