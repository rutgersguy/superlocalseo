# Billing sign-out

The billing route is protected by the same authentication-only guard as the dashboard. It remains accessible to authenticated customers with expired trials, but clearing the session now navigates to login. Previously the logout request cleared authentication while the unguarded billing page stayed visible, making Sign out appear ineffective. The isolated browser regression verifies logout returns204, navigates to login, and cannot reopen billing after sign-out.
