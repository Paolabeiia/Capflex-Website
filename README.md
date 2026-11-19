# Capflex · Site Match

Plug new energy projects into grid capacity that factories already have.

- **Website:** static HTML, CSS and JavaScript, served by GitHub Pages.
- **Data:** Supabase (`supabase/001_marketplace.sql` for tables and row level security, `supabase/002_demo_data.sql` for the demo marketplace).
- **Privacy:** everyone can read the anonymous marketplace (codes, regions, capacity, bids). Company names, addresses, contacts and exact locations are in `site_private` and `project_private`, readable only by the person who entered them and by Capflex admins (table `admins`).
- **Grid map:** high-voltage grid from OpenStreetMap (© OpenStreetMap contributors, ODbL), borders from Natural Earth, congestion by German state from the Bundesnetzagentur's congestion management reports 2021 and 2022.

The Supabase URL and anon key in `config.js` are public by design; row level security decides what anyone can read or write.
