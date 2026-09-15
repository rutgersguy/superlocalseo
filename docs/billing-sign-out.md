# Billing sign-out

The billing route is protected by the same authentication-only guard as the dashboard. It remains accessible to authenticated customers with expired trials, but clearing the session now navigates to login. Previously the logout request cleared authentication while the unguarded billing page stayed visible, making Sign out appear ineffective. The isolated browser regression verifies logout returns204, navigates to login, and cannot reopen billing after sign-out.

The general API budget is now 1,000 requests per15minutes instead of100, accommodating normal multi-request dashboard pages and progress polling. Login/password reset and paid AI-action limits remain unchanged. Logout is exempt from the general limiter so reaching a browsing limit cannot trap a session. First-scan status polls stop when finished and slow while waiting for customer inputs.
