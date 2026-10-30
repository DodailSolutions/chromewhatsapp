# Dodail Reach 0.8.0 + License Platform v2 — Test report (30 Oct 2026)

Every test ran in Chrome with the real extension loaded and a fresh license server on an embedded Postgres database. WhatsApp Web, the Claude API, Calendly and a business website were all simulated; nothing was tested on the live WhatsApp Web.

| Suite | What it covers | Result |
|---|---|---|
| Licensing end to end | The admin flow below, from the dashboard through the extension | 18 / 18 checks |
| UX features | The onboarding, licensing and status features below | 16 / 16 checks |
| Admin dashboard | The admin features below | 9 / 9 checks |
| Security | The attack tests below | 27 / 27 checks |
| AI agent | The AI agent run below | Pass, 0 console errors |
| Broadcasts & media | The broadcast and media run below | Pass, 0 console errors |
| Saved-contact replies | A number saved as "Teddy" replies "1", for new broadcasts and broadcasts already sent | Pass |
| All 10 categories | Sidebar tabs fit, top bar fits and the module tab renders for every business type | 10 / 10 |
| Chrome Web Store validator | Manifest, CSP, remote code, permissions | 0 errors (20 documented innerHTML warnings; all data is escaped) |

**Licensing end to end** checked this flow:
1. Admin login and a wrong password rejected.
2. Key generated.
3. The details form stays hidden until a key is activated; bad keys are rejected.
4. The business name is prefilled from the license.
5. Registration.
6. The sidebar unlocks; the dashboard counts are correct.
7. Deactivating locks the extension and hides the top bar; reactivating unlocks it.
8. Renewal adds 30 days.
9. Usage stats and version are reported.
10. A tampered license is rejected and a second computer is blocked.
11. Release, then re-activation from the sidebar.

**UX features** covered:
- Onboarding steps.
- Registration details reaching the admin.
- Reopening registration skips the key step.
- The 0-of-5 checklist, and import ticking a step.
- The renewal banner and its WhatsApp link.
- Setting a broadcast reply by hand, with tagging.
- A clock wound back locks with a clear message.
- An admin release locks the old computer, and one click re-activates it.
- License status shown in Settings and the popup.

**Admin dashboard** covered:
- The "send key on WhatsApp" link.
- Revenue totals.
- Renewals due, and the reminder message.
- The renew dialog with amount.
- License history and total paid.
- Input validation.
- No sideways scrolling on phones.

**Security** tested:
- Every admin endpoint needs a login.
- Forged or edited session cookies are rejected.
- The CSRF header is required.
- Session cookies are HttpOnly and SameSite=Strict.
- SQL-injection strings are harmless.
- Server source code can't be downloaded.
- Oversized bodies get a 413; malformed JSON gets a 400.
- One key works on one computer.
- A released key can't be kept alive through checks.
- An activated key can't be deleted; negative renewals are refused.
- CSV formulas are neutralised.
- Stored XSS shows as text and doesn't run.
- CSP and anti-framing headers are sent.
- A password change signs out old sessions.
- Login brute force and key guessing are rate-limited.

**AI agent** run:
- Claude replies using the price-list PDF.
- The CRM is filled from the chat, with a follow-up.
- A booking request gets the Calendly link.
- Calendly sync matches the contact and sends a WhatsApp confirmation with the Meet link.
- Suggest mode drafts without sending.

**Broadcasts & media** run:
- WhatsApp setup check, with auto-send and a test image.
- A broadcast to new numbers with 3 attachments (photo, PDF, MP3) and reply options.
- A STOP number is skipped.
- Replies are counted as Interested and STOP.

## Bugs found and fixed in this round

1. **Released keys could keep working (security).** After you released a key, the old computer could keep getting valid licenses from routine checks. A key must now be activated on a computer before checks succeed. The old computer locks with "released" and can re-activate in one click.
2. **Winding the clock back (security).** Setting the computer's date backwards could stretch an expired license or the offline grace period. Reach now records the latest time it has seen and the server's signed time, and locks with "check your computer's date".
3. **Distributed password guessing (security).** Besides the per-IP limit, admin login now stops after 60 failed attempts from all IPs in 15 minutes.
4. **CSV export (security).** Values starting with a tab or carriage return are now neutralised like `=`, `+`, `-` and `@`.
5. **Oversized requests.** They reset the connection; they now return a clean 413 error.
6. **Changing to a new key** left the old key bound to the computer. The old key is now freed automatically.
7. **Renew with 0 or negative days** silently added 1 day. It's now refused with a message.
8. **Customer details missing in admin.** Business details only reached the admin at activation, so edits to the registration never arrived. They're now sent with every check.
9. **Sidebar tabs overflowed** for long module names such as "Appointments" in the salon category. The tabs now shrink to fit, and the salon tab is renamed "Bookings".
10. **Extension page links.** The `open-page` message now only accepts simple `#section` links.
11. **Saved-contact replies (fixed 26 Oct, re-tested).** Replies from numbers saved under a name weren't counted.

## Known limits

- **Not tested on the live WhatsApp Web.** All runs used a simulated page. Test once on the real site with Broadcast → Check WhatsApp setup.
- **Code can still be edited.** Anyone with the zip can open and edit the extension's code. The license check makes edited copies hard to use, but not impossible. The next step in the plan (scrambled builds, plus AI replies and WhatsApp page settings served from your server) makes edited copies useless.
- **One test timing failure.** The saved-contact test failed once when four suites ran at the same time on one machine, because the broadcast was still running when the next step began. It passes when run on its own.
