# Student wallet passes

Accepted students can add one ASWJ College student pass to Apple Wallet or
Google Wallet from the authenticated Student Portal. The pass reuses the same
opaque QR token as the existing classroom check-in screen. The Student Portal,
not the installed pass, lists the student's current classes and schedule so an
older phone pass cannot display stale timetable information. The pass does not include email, phone, date of
birth, guardian, medical, allergy or learning information.

The first release uses on-demand identity passes. The attendance scanner remains
the source of truth: a copied or older pass cannot check in if the QR token is
inactive or the student is no longer actively enrolled in that class. Automated
Apple/Google push updates are deliberately outside this first release.

## Safety boundaries

- Keep `WALLET_PASSES_ENABLED=false` until the selected provider is complete.
- Configure and test the separate dev/Preview deployment first.
- Dev requires a Pass Type ID containing `.dev` and a Google class ID
  containing `dev`.
- The configured Supabase project ref must match the environment, and dev must
  be different from the Production project ref.
- All certificates, private keys, service-account JSON and ID secrets are
  server-only Vercel **Sensitive** variables. Never prefix them with
  `NEXT_PUBLIC_`, commit them, paste them into tickets, or send them in chat.
- Pass routes authenticate the current student and load only that student's
  RLS-protected active enrolments and QR. They do not accept a student ID or QR
  from the browser.

## Apple Wallet dev setup

1. In the Apple Developer account, create a dev Pass Type ID such as
   `pass.com.aswjcollege.student.dev`.
2. Create a Pass Type ID certificate, download it to Keychain Access, and
   export the certificate plus private key as a password-protected `.p12`.
3. Download the Apple Worldwide Developer Relations intermediate certificate
   associated with the pass certificate from Apple.
4. Convert the local files. Run these commands on a trusted computer and do
   not place the outputs in this repository:

   ```bash
   openssl pkcs12 -in dev-pass.p12 -clcerts -nokeys -out signer-cert.pem
   openssl pkcs12 -in dev-pass.p12 -nocerts -nodes -out signer-key.pem
   openssl pkcs8 -topk8 -nocrypt -in signer-key.pem -out signer-key-pkcs8.pem
   openssl x509 -inform DER -in AppleWWDR.cer -out wwdr.pem
   ```

5. An authorised representative for the Apple Developer account must read and
   accept Apple's Wallet Marketing Artwork License Agreement, then download the
   official English (Australia) SVG badge. Add that unmodified file at
   `public/wallet/add-to-apple-wallet.svg`. The app deliberately keeps Apple
   disabled when this licensed artwork is absent.
6. In the Vercel project, add these **Preview only** Sensitive variables:

   - `APPLE_WALLET_PASS_TYPE_ID`
   - `APPLE_WALLET_TEAM_ID`
   - `APPLE_WALLET_SIGNER_CERT_PEM_BASE64`
   - `APPLE_WALLET_PRIVATE_KEY_PEM_BASE64`
   - `APPLE_WALLET_WWDR_CERT_PEM_BASE64`
   - `APPLE_WALLET_BADGE_LICENSE_ACCEPTED=true`

   Create each single-line base64 value locally with:

   ```bash
   base64 < signer-cert.pem | tr -d '\n'
   base64 < signer-key-pkcs8.pem | tr -d '\n'
   base64 < wwdr.pem | tr -d '\n'
   ```

7. After all shared variables below are set, redeploy dev. Sign in as an
   accepted student on an iPhone, open **Your student pass**, and tap
   the official **Add to Apple Wallet** badge. Confirm the pass shows the student's name
   and `DEV TEST`, then scan it through the teacher attendance
   screen.

Official references:

- [Apple: create Wallet identifiers and certificates](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates)
- [Apple: building a pass](https://developer.apple.com/documentation/walletpasses/building-a-pass)
- [Apple: distributing passes](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/DistributingPasses.html)

## Google Wallet dev setup

1. Create or open the ASWJ issuer in the Google Pay & Wallet Console. Leave it
   in demo mode for initial testing.
2. Enable the Google Wallet API in the linked Google Cloud project.
3. Create a dedicated service account and add its email as a Developer in the
   Google Wallet issuer account. Download one JSON key and store it securely.
4. Create a Generic Class with an ID such as
   `<issuer-id>.aswj_student_dev`. The app references this existing class; it
   does not create or change classes during a student request.
5. Add the Android test account to the issuer's test users while the issuer is
   in demo mode.
6. In Vercel, add these **Preview only** Sensitive variables:

   - `GOOGLE_WALLET_ISSUER_ID`
   - `GOOGLE_WALLET_CLASS_ID`
   - `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`

   Create the JSON value locally with:

   ```bash
   base64 < google-wallet-service-account.json | tr -d '\n'
   ```

7. After the shared variables are set, redeploy dev. Sign in as an accepted
   student on Android, tap the official **Add to Google Wallet** button,
   confirm the pass shows `[TEST ONLY]`, and scan it through the teacher
   attendance screen.

Official references:

- [Google Wallet issuer onboarding](https://developers.google.com/wallet/generic/getting-started/issuer-onboarding)
- [Google Wallet service-account authentication](https://developers.google.com/wallet/generic/getting-started/auth/rest)
- [Google Wallet web add flow](https://developers.google.com/wallet/generic/web)

## Shared dev variables

Add these as **Preview only** variables for the dev branch:

```text
WALLET_PASSES_ENABLED=true
WALLET_ENVIRONMENT=dev
WALLET_ID_SECRET=<new random value of at least 32 characters>
WALLET_APP_BASE_URL=https://aswj-college-git-dev-aswj-college.vercel.app
WALLET_EXPECTED_SUPABASE_PROJECT_REF=plneieatzymjrvlswqqo
WALLET_PRODUCTION_SUPABASE_PROJECT_REF=<the different production ref>
```

Generate `WALLET_ID_SECRET` locally with `openssl rand -hex 32`. The same value
must remain stable in dev so a student receives the same opaque wallet object
ID when downloading the pass again.

## Device test checklist

Use a confirmed test student with an accepted application, active enrolment and
active QR token.

1. Student Portal shows the same active class name, day, time and location as
   Admin class setup; the installed identity pass does not duplicate this
   changeable timetable.
2. Apple pass downloads only while signed in as that student and installs on an
   iPhone.
3. Google save link opens only while signed in and installs for an approved
   Google test account.
4. Neither pass contains email, phone, date of birth, guardian or wellbeing
   data.
5. QR scan records the correct student in the correct active class.
6. Repeating the scan does not create a duplicate attendance record.
7. A student cannot generate another student's pass by changing a URL.
8. Signing out makes both wallet routes return to login.
9. Suspending or withdrawing the only enrolment makes the pass unavailable in
   the portal and makes its existing QR fail class eligibility at the scanner.

Do not enable Production until both device paths and the rejection cases pass
in dev. Production requires separate provider identifiers/credentials and a
separate approval.
