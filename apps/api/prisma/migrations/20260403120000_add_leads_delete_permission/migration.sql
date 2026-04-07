-- Permissão leads.delete (eliminar lead) e atribuição ao papel admin.
-- Idempotente: pode correr várias vezes.

INSERT INTO permissions (id, code)
SELECT gen_random_uuid(), 'leads.delete'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'leads.delete');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.code = 'leads.delete'
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
