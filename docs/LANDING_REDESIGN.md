# Homepage redesign — September 9, 2026

The public homepage follows `sls_homepage.png`: cream canvas, forest-green editorial headings, orange actions, an illustrative monthly report, three monitoring steps, owner/office photo, compact Lite/Pro pricing, and landscape footer.

Implementation covers the landing page, its stylesheet, public artwork, and homepage metadata. The authenticated app and generated customer PDFs now share the same visibility-brief design language, but the report preview remains explicitly illustrative and is not an actual customer PDF. Sample service-area coverage is labeled Pro. Public prices remain Lite $149/month, Pro $349/month, and Pro additional locations $125/month.

The free business check now opens the native `/audit` report flow (see `native-free-reports-2026-09-09.md`). Sample-report buttons open a native modal dialog with Escape dismissal and focus restoration. Choose your plan opens a native details comparison with the existing plan-specific registration links. Footer privacy, terms, contact and sign-in links remain available.

The supplied reference PNG is reused as public artwork; CSS frames only its office photograph and bottom landscape. Replace those with separate original assets if higher-resolution source artwork becomes available. Other elements, including all copy and the report illustration, are rendered in HTML/CSS/SVG. Georgia is the locally available editorial serif fallback; the existing Inter body font is retained.

Validation: production TypeScript/Vite build; browser checks at 1440, 1122, 768, 390 and 320 pixels; no horizontal overflow; sample-dialog open/Escape/keyboard focus restoration; plan comparison and plan-specific destinations; mobile navigation; registration and login route rendering; no browser runtime errors. No customer accounts, payments or external business-check submissions were used.
