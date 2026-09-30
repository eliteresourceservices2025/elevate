-- Reference data: the document types ERS starts with. HR can add, rename and retire types in the app.
-- required_for_all means every active person should have one (HR sees who is missing it).
INSERT INTO docs.document_types (slug, name, scope, requires_expiry, requires_client, required_for_all) VALUES
  ('nbi_clearance',          'NBI clearance',                 'employee', true,  false, true),
  ('government_id',          'Government ID',                 'employee', true,  false, true),
  ('hipaa_training',         'HIPAA training certificate',    'employee', true,  false, false),
  ('client_confidentiality', 'Client confidentiality agreement', 'employee', false, true,  false),
  ('background_check',       'Background check',              'employee', true,  false, false),
  ('contract',               'Contract',                      'employee', false, false, false),
  ('resume',                 'Resume',                        'employee', false, false, false),
  ('other_employee',         'Other',                         'employee', false, false, false),
  ('company_policy',         'Policy',                        'company',  false, false, false),
  ('company_form',           'Form',                          'company',  false, false, false),
  ('company_other',          'Other company document',        'company',  false, false, false)
ON CONFLICT (slug) DO NOTHING;
