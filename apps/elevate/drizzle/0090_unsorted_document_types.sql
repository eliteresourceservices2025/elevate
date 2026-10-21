-- Reference data: where bulk-uploaded files land until HR gives them a real type ("categorize later").
INSERT INTO docs.document_types (slug, name, scope, requires_expiry, requires_client, required_for_all) VALUES
  ('unsorted_employee', 'Unsorted', 'employee', false, false, false),
  ('unsorted_company',  'Unsorted company file', 'company',  false, false, false)
ON CONFLICT (slug) DO NOTHING;
