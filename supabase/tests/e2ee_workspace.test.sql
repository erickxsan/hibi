begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2ee-a@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2ee-b@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claim.role = 'authenticated';

select throws_ok(
  $$update public.workspace_encryption_profiles set workspace_revision = 9$$,
  '42501',
  'permission denied for table workspace_encryption_profiles',
  'authenticated clients cannot write encryption profiles directly'
);

select lives_ok($$
  select public.begin_workspace_e2ee_migration(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    1::smallint,
    1::integer,
    jsonb_build_object(
      'wrapperId', '30000000-0000-4000-8000-000000000001',
      'type', 'passkey',
      'label', 'Primary passkey',
      'credentialId', 'credential-A',
      'prfSalt', repeat('S', 43),
      'transports', '[]'::jsonb,
      'wrapperVersion', 1,
      'keyVersion', 1,
      'nonce', repeat('N', 16),
      'wrappedKey', repeat('W', 48)
    )
  )
$$, 'a passkey starts mandatory encryption migration');

select is(
  (select migration_status from public.workspace_encryption_profiles),
  'migration_started',
  'the profile remains gated while ciphertext is staged'
);
select is((select count(*) from public.workspace_key_wrappers), 1::bigint, 'the initial AMK wrapper is stored');

select throws_ok($$
  select public.stage_workspace_e2ee_entities(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    jsonb_build_array(jsonb_build_object(
      'collection', 'settings',
      'entityId', '__settings__',
      'entityRevision', 1,
      'schemaVersion', 1,
      'keyVersion', 1,
      'nonce', repeat('N', 16),
      'ciphertext', repeat('C', 32),
      'plaintext', '{"hourlyRate":50}'
    ))
  )
$$, '22023', 'invalid_encrypted_entity_envelope', 'staging rejects extra plaintext fields');

select throws_ok($$
  select public.stage_workspace_e2ee_snapshot(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    jsonb_build_object(
      'id', '30000000-0000-4000-8000-000000000002',
      'sourceRevision', 0,
      'envelopes', jsonb_build_array(jsonb_build_object(
        'collection', 'settings', 'entityId', '__settings__', 'entityRevision', 1,
        'schemaVersion', 1, 'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('C', 32)
      )),
      'manifest', jsonb_build_object(
        'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 0,
        'root', repeat('R', 43), 'previousRoot', null, 'entityCount', 1, 'schemaVersion', 1,
        'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000003', 'mac', repeat('M', 43)
      ),
      'plaintext', 'must never be stored'
    ),
    now()
  )
$$, '22023', 'invalid_encrypted_snapshot', 'snapshot staging rejects undeclared plaintext fields');

select lives_ok($$
  select public.stage_workspace_e2ee_entities(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    jsonb_build_array(jsonb_build_object(
      'collection', 'settings',
      'entityId', '__settings__',
      'entityRevision', 1,
      'schemaVersion', 1,
      'keyVersion', 1,
      'nonce', repeat('N', 16),
      'ciphertext', repeat('C', 32)
    ))
  )
$$, 'a valid encrypted settings envelope can be staged');

select is(
  (select jsonb_array_length(envelopes) from public.load_workspace_e2ee_migration_staging('33333333-3333-4333-8333-333333333333')),
  1,
  'staging reload returns exactly the validated envelope'
);

select throws_ok($$
  select public.stage_workspace_e2ee_import_receipt(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    jsonb_build_object(
      'fingerprint', repeat('F', 43), 'resultRevision', 1, 'keyVersion', 1,
      'nonce', repeat('N', 16), 'ciphertext', repeat('C', 32), 'sourceName', 'readable.json'
    ),
    now()
  )
$$, '22023', 'invalid_encrypted_import_receipt', 'import staging rejects readable metadata');

select lives_ok($$
  select public.stage_workspace_e2ee_import_receipt(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    jsonb_build_object(
      'fingerprint', repeat('F', 43), 'resultRevision', 1, 'keyVersion', 1,
      'nonce', repeat('N', 16), 'ciphertext', repeat('C', 32)
    ),
    now()
  )
$$, 'validated encrypted import history can be staged');

select is(
  (select jsonb_array_length(import_receipts)
    from public.load_workspace_e2ee_migration_staging('33333333-3333-4333-8333-333333333333')),
  1,
  'staging reload includes encrypted import history'
);

select lives_ok($$
  select * from public.finalize_workspace_e2ee_migration(
    '33333333-3333-4333-8333-333333333333',
    'workspace_crypto_A1',
    1,
    jsonb_build_object(
      'protocolVersion', 1,
      'workspaceCryptoId', 'workspace_crypto_A1',
      'workspaceRevision', 1,
      'root', repeat('R', 43),
      'previousRoot', null,
      'entityCount', 1,
      'schemaVersion', 1,
      'keyVersion', 1,
      'operationId', '30000000-0000-4000-8000-000000000004',
      'mac', repeat('M', 43)
    )
  )
$$, 'verified staging can be promoted atomically');

select is((select migration_status from public.workspace_encryption_profiles), 'active', 'the encrypted profile becomes active');
select is((select workspace_revision from public.workspace_encryption_profiles), 1::bigint, 'activation starts at revision one');
select is((select count(*) from public.encrypted_workspace_entities), 1::bigint, 'only one ciphertext entity is active');
select is((select count(*) from public.workspace_settings), 0::bigint, 'readable normalized settings are scrubbed');
select is((select count(*) from public.workspaces), 0::bigint, 'the legacy full document row is deleted');
select is((select count(*) from public.encrypted_workspace_change_events), 1::bigint, 'activation emits one encrypted event');
select is((select count(*) from public.encrypted_workspace_import_receipts), 1::bigint, 'encrypted import history is promoted');

select lives_ok($$
  select public.touch_workspace_key_wrapper(
    '33333333-3333-4333-8333-333333333333',
    '30000000-0000-4000-8000-000000000001'
  )
$$, 'an owner can record successful use of an active wrapper');
select ok((select last_used_at is not null from public.workspace_key_wrappers), 'wrapper inventory records last use');

select throws_ok($$
  insert into public.encrypted_workspace_entities (
    owner_id, collection, entity_id, entity_revision, schema_version, key_version, nonce, ciphertext
  ) values (
    '33333333-3333-4333-8333-333333333333', 'groups', 'direct', 1, 1, 1, repeat('N', 16), repeat('C', 32)
  )
$$, '42501', 'permission denied for table encrypted_workspace_entities', 'direct ciphertext writes are denied');

select throws_ok($$
  select * from public.apply_encrypted_workspace_mutation(
    '33333333-3333-4333-8333-333333333333',
    1,
    '30000000-0000-4000-8000-000000000005',
    jsonb_build_array(jsonb_build_object(
      'collection', 'groups', 'entityId', 'g1', 'entityRevision', 1, 'schemaVersion', 1,
      'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('C', 32), 'name', 'Readable name'
    )),
    '[]'::jsonb,
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 2,
      'root', repeat('S', 43), 'previousRoot', repeat('R', 43), 'entityCount', 2, 'schemaVersion', 1,
      'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000005', 'mac', repeat('M', 43)
    )
  )
$$, '22023', 'invalid_encrypted_entity_envelope', 'mutations reject extra readable entity fields');

select lives_ok($$
  select * from public.apply_encrypted_workspace_mutation(
    '33333333-3333-4333-8333-333333333333',
    1,
    '30000000-0000-4000-8000-000000000006',
    jsonb_build_array(jsonb_build_object(
      'collection', 'groups', 'entityId', 'g1', 'entityRevision', 1, 'schemaVersion', 1,
      'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('D', 32)
    )),
    '[]'::jsonb,
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 2,
      'root', repeat('S', 43), 'previousRoot', repeat('R', 43), 'entityCount', 2, 'schemaVersion', 1,
      'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000006', 'mac', repeat('M', 43)
    )
  )
$$, 'a valid encrypted entity mutation advances independently');

select is((select workspace_revision from public.workspace_encryption_profiles), 2::bigint, 'the encrypted workspace revision advances');

select lives_ok($$
  select * from public.apply_encrypted_workspace_mutation(
    '33333333-3333-4333-8333-333333333333',
    1,
    '30000000-0000-4000-8000-000000000006',
    jsonb_build_array(jsonb_build_object(
      'collection', 'groups', 'entityId', 'g1', 'entityRevision', 1, 'schemaVersion', 1,
      'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('D', 32)
    )),
    '[]'::jsonb,
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 2,
      'root', repeat('S', 43), 'previousRoot', repeat('R', 43), 'entityCount', 2, 'schemaVersion', 1,
      'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000006', 'mac', repeat('M', 43)
    )
  )
$$, 'retrying the same encrypted operation is idempotent');

select is((select count(*) from public.encrypted_workspace_change_events), 2::bigint, 'an idempotent retry emits no duplicate event');

select throws_ok($$
  select * from public.apply_encrypted_workspace_mutation(
    '33333333-3333-4333-8333-333333333333',
    2,
    '30000000-0000-4000-8000-000000000007',
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'collection', 'groups', 'entityId', 'g1', 'expectedRevision', 1, 'plaintext', 'leak'
    )),
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 3,
      'root', repeat('T', 43), 'previousRoot', repeat('S', 43), 'entityCount', 1, 'schemaVersion', 1,
      'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000007', 'mac', repeat('M', 43)
    )
  )
$$, '22023', 'invalid_encrypted_deletion', 'encrypted deletions reject extra readable fields');

select lives_ok($$
  select * from public.replace_encrypted_workspace(
    '33333333-3333-4333-8333-333333333333', 2,
    '30000000-0000-4000-8000-000000000008', 'import',
    jsonb_build_array(
      jsonb_build_object(
        'collection', 'settings', 'entityId', '__settings__', 'entityRevision', 1, 'schemaVersion', 1,
        'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('E', 32)
      ),
      jsonb_build_object(
        'collection', 'groups', 'entityId', 'g1', 'entityRevision', 1, 'schemaVersion', 1,
        'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('D', 32)
      )
    ),
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 3,
      'root', repeat('T', 43), 'previousRoot', repeat('S', 43), 'entityCount', 2, 'schemaVersion', 1,
      'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000008', 'mac', repeat('M', 43)
    ),
    jsonb_build_object(
      'fingerprint', repeat('G', 43), 'resultRevision', 3, 'keyVersion', 1,
      'nonce', repeat('N', 16), 'ciphertext', repeat('Q', 32)
    )
  )
$$, 'an encrypted import replacement is accepted');

select lives_ok($$
  select * from public.replace_encrypted_workspace(
    '33333333-3333-4333-8333-333333333333', 2,
    '30000000-0000-4000-8000-000000000009', 'import',
    jsonb_build_array(jsonb_build_object(
      'collection', 'settings', 'entityId', '__settings__', 'entityRevision', 1, 'schemaVersion', 1,
      'keyVersion', 1, 'nonce', repeat('N', 16), 'ciphertext', repeat('E', 32)
    )),
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 3,
      'root', repeat('T', 43), 'previousRoot', repeat('S', 43), 'entityCount', 1, 'schemaVersion', 1,
      'keyVersion', 1, 'operationId', '30000000-0000-4000-8000-000000000009', 'mac', repeat('M', 43)
    ),
    jsonb_build_object(
      'fingerprint', repeat('G', 43), 'resultRevision', 3, 'keyVersion', 1,
      'nonce', repeat('N', 16), 'ciphertext', repeat('Q', 32)
    )
  )
$$, 'retrying the same encrypted import fingerprint is idempotent');

select is((select count(*) from public.encrypted_workspace_change_events), 3::bigint, 'an import retry emits no duplicate event');

select lives_ok($$
  select public.begin_staged_workspace_key_rotation(
    '33333333-3333-4333-8333-333333333333', 3,
    '30000000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 4,
      'root', repeat('U', 43), 'previousRoot', repeat('T', 43), 'entityCount', 2, 'schemaVersion', 1,
      'keyVersion', 2, 'operationId', '30000000-0000-4000-8000-000000000010', 'mac', repeat('M', 43)
    )
  )
$$, 'a large key rotation can start without replacing active records');

select lives_ok($$
  select public.stage_workspace_key_rotation_entities(
    '33333333-3333-4333-8333-333333333333',
    '30000000-0000-4000-8000-000000000010',
    jsonb_build_array(
      jsonb_build_object(
        'collection', 'settings', 'entityId', '__settings__', 'entityRevision', 1, 'schemaVersion', 1,
        'keyVersion', 2, 'nonce', repeat('N', 16), 'ciphertext', repeat('V', 32)
      ),
      jsonb_build_object(
        'collection', 'groups', 'entityId', 'g1', 'entityRevision', 1, 'schemaVersion', 1,
        'keyVersion', 2, 'nonce', repeat('N', 16), 'ciphertext', repeat('W', 32)
      )
    )
  )
$$, 'rotated entities can be staged in a bounded batch');

select lives_ok($$
  select public.stage_workspace_key_rotation_snapshot(
    '33333333-3333-4333-8333-333333333333',
    '30000000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'id', '30000000-0000-4000-8000-000000000011', 'sourceRevision', 3,
      'originalCreatedAt', now(), 'keyVersion', 2,
      'envelopes', jsonb_build_array(
        jsonb_build_object(
          'collection', 'settings', 'entityId', '__settings__', 'entityRevision', 1, 'schemaVersion', 1,
          'keyVersion', 2, 'nonce', repeat('N', 16), 'ciphertext', repeat('V', 32)
        ),
        jsonb_build_object(
          'collection', 'groups', 'entityId', 'g1', 'entityRevision', 1, 'schemaVersion', 1,
          'keyVersion', 2, 'nonce', repeat('N', 16), 'ciphertext', repeat('W', 32)
        )
      ),
      'manifest', jsonb_build_object(
        'protocolVersion', 1, 'workspaceCryptoId', 'workspace_crypto_A1', 'workspaceRevision', 3,
        'root', repeat('X', 43), 'previousRoot', null, 'entityCount', 2, 'schemaVersion', 1,
        'keyVersion', 2, 'operationId', '30000000-0000-4000-8000-000000000012', 'mac', repeat('M', 43)
      )
    )
  )
$$, 'a rotated snapshot is staged independently');

select lives_ok($$
  select public.stage_workspace_key_rotation_import_receipts(
    '33333333-3333-4333-8333-333333333333',
    '30000000-0000-4000-8000-000000000010',
    jsonb_build_array(
      jsonb_build_object(
        'receipt', jsonb_build_object(
          'fingerprint', repeat('H', 43), 'resultRevision', 1, 'keyVersion', 2,
          'nonce', repeat('N', 16), 'ciphertext', repeat('Q', 32)
        ), 'originalCreatedAt', now()
      ),
      jsonb_build_object(
        'receipt', jsonb_build_object(
          'fingerprint', repeat('I', 43), 'resultRevision', 3, 'keyVersion', 2,
          'nonce', repeat('N', 16), 'ciphertext', repeat('R', 32)
        ), 'originalCreatedAt', now()
      )
    )
  )
$$, 'rotated import history is staged without readable hashes');

select lives_ok($$
  select public.stage_workspace_key_rotation_wrappers(
    '33333333-3333-4333-8333-333333333333',
    '30000000-0000-4000-8000-000000000010',
    jsonb_build_array(jsonb_build_object(
      'wrapperId', '30000000-0000-4000-8000-000000000001', 'type', 'passkey',
      'label', 'Primary passkey', 'credentialId', 'credential-A', 'prfSalt', repeat('S', 43),
      'transports', '[]'::jsonb, 'wrapperVersion', 1, 'keyVersion', 2,
      'nonce', repeat('N', 16), 'wrappedKey', repeat('Z', 48)
    ))
  )
$$, 'the new passkey wrapper is staged');

select lives_ok($$
  select * from public.finalize_staged_workspace_key_rotation(
    '33333333-3333-4333-8333-333333333333',
    '30000000-0000-4000-8000-000000000010'
  )
$$, 'staged key rotation publishes atomically');

select is((select workspace_revision from public.workspace_encryption_profiles), 4::bigint, 'rotation advances the global revision');
select is((select active_key_version from public.workspace_encryption_profiles), 2, 'rotation activates AMK version two');
select is((select count(*) from public.encrypted_workspace_entities), 2::bigint, 'rotation publishes every staged entity');
select is((select count(*) from public.encrypted_workspace_snapshots), 1::bigint, 'rotation replaces snapshots with staged ciphertext');
select is((select count(*) from public.encrypted_workspace_import_receipts), 2::bigint, 'rotation preserves encrypted import history');

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
select is((select count(*) from public.workspace_encryption_profiles), 0::bigint, 'another account cannot see the encrypted profile');
select is((select count(*) from public.encrypted_workspace_import_receipts), 0::bigint, 'another account cannot see encrypted import history');
select is(
  (select enabled from public.workspace_e2ee_rollout_status('44444444-4444-4444-8444-444444444444')),
  true,
  'every legacy account must activate E2EE before continuing'
);
select throws_ok(
  $$select * from public.load_encrypted_workspace('33333333-3333-4333-8333-333333333333')$$,
  '42501',
  'account_changed',
  'an encrypted load cannot be rebound to another owner'
);

reset role;
select is((select count(*) from public.workspace_e2ee_rotation_staging), 0::bigint, 'successful rotation removes all staging through cascade');
select is((select mode from public.workspace_e2ee_rollout_config where singleton = 1), 'required', 'E2EE is mandatory after the rollout migration');
select ok(has_function_privilege('authenticated', 'public.workspace_e2ee_rollout_status(uuid)', 'EXECUTE'), 'authenticated clients can read their rollout decision');
select ok(not has_table_privilege('authenticated', 'public.workspace_e2ee_rollout_config', 'SELECT'), 'clients cannot alter or enumerate rollout configuration');
select ok(not has_table_privilege('authenticated', 'public.encrypted_workspace_entities', 'INSERT'), 'authenticated clients cannot insert encrypted rows directly');
select ok(has_function_privilege('authenticated', 'public.apply_encrypted_workspace_mutation(uuid,bigint,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'), 'authenticated clients can execute the validated encrypted writer');
select ok(not has_function_privilege('anon', 'public.apply_encrypted_workspace_mutation(uuid,bigint,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'), 'anonymous clients cannot execute the encrypted writer');
select ok(exists(
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'encrypted_workspace_change_events'
), 'Realtime publishes only the encrypted change feed');

select * from finish();
rollback;
