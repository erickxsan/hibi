begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select set_config('test.wrapper', jsonb_build_object(
  'wrapperId', '55555555-5555-4555-8555-555555555555',
  'type', 'recovery', 'wrapperVersion', 1, 'keyVersion', 1,
  'nonce', repeat('N', 16), 'wrappedKey', repeat('W', 64),
  'recoveryFingerprint', repeat('F', 43)
)::text, true);

select lives_ok($$select private.assert_workspace_key_wrapper(current_setting('test.wrapper')::jsonb, 1, array['recovery'])$$,
  'full SHA-256 recovery fingerprint is accepted');
select lives_ok($$select private.assert_workspace_key_wrapper(jsonb_set(current_setting('test.wrapper')::jsonb, '{recoveryFingerprint}', to_jsonb(repeat('F', 14))), 1, array['recovery'])$$,
  'legacy truncated recovery fingerprint remains accepted');
select throws_ok($$select private.assert_workspace_key_wrapper(jsonb_set(current_setting('test.wrapper')::jsonb, '{recoveryFingerprint}', to_jsonb(repeat('F', 15))), 1, array['recovery'])$$,
  '22023', 'invalid_workspace_key_wrapper', 'unknown fingerprint formats are rejected');
select throws_ok($$select private.assert_workspace_key_wrapper(null, 1, array['recovery'])$$,
  '22023', 'invalid_workspace_key_wrapper', 'a null wrapper cannot pass validation');
select throws_ok($$select private.assert_workspace_key_wrapper(current_setting('test.wrapper')::jsonb - 'type', 1, array['recovery'])$$,
  '22023', 'invalid_workspace_key_wrapper', 'a missing wrapper type cannot pass validation');

select set_config('test.password_wrapper', (
  (current_setting('test.wrapper')::jsonb - 'recoveryFingerprint') || jsonb_build_object(
    'type', 'password', 'kdfAlgorithm', 'pbkdf2-sha256', 'kdfIterations', 600000, 'kdfSalt', repeat('S', 43)
  )
)::text, true);
select lives_ok($$select private.assert_workspace_key_wrapper(current_setting('test.password_wrapper')::jsonb, 1, array['password'])$$,
  'a complete password wrapper is accepted');
select throws_ok($$select private.assert_workspace_key_wrapper(current_setting('test.password_wrapper')::jsonb - 'kdfAlgorithm', 1, array['password'])$$,
  '22023', 'invalid_workspace_key_wrapper', 'missing KDF algorithm cannot bypass SQL null comparisons');

select * from finish();
rollback;
