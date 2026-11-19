# Capflex · Site Match

Plug new energy projects into grid capacity that factories already have.

- **Website:** static HTML, CSS and JavaScript, served by GitHub Pages.
- **Data:** Supabase (`supabase/001_marketplace.sql` for tables and row level security, `supabase/002_demo_data.sql` for the demo marketplace).
- **Privacy:** everyone can read the anonymous marketplace (codes, regions, capacity, bids). Company names, addresses, contacts and exact locations are in `site_private` and `project_private`, readable only by the person who entered them and by Capflex admins (table `admins`).
- **Grid map:** high-voltage grid from OpenStreetMap (© OpenStreetMap contributors, ODbL), borders from Natural Earth, congestion by German state from the Bundesnetzagentur's congestion management reports 2021 and 2022.

The Supabase URL and anon key in `config.js` are public by design; row level security decides what anyone can read or write.

## Accounts

Anyone can create an account with an email and a password (Create account on the Site Match page). They can also sign in with a link sent by email.

- With **Confirm email** switched on in Supabase (Authentication, Providers, Email), a new user must open a confirmation link before signing in.
- Supabase's built-in email sender allows only a few emails per hour for the whole project. Beyond that, sign-up and sign-in links fail with "email rate limit exceeded". For real use, either set up your own SMTP sender in Supabase or switch Confirm email off, so that registering signs the user in at once.
