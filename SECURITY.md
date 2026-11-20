# Security

Report a problem privately through GitHub: **Security > Report a vulnerability** on this repository
(https://github.com/lvcocousa-design/dsh-free-models/security/advisories/new). Please do not open a public issue
for anything that exposes keys, prompts or billing.

In scope: the router and settings page leaking a key or prompt, a way around the billing guard (a request sent to
a model or route the guard should block), and the status or reset endpoints doing more than documented.

Known and documented, not vulnerabilities: dsh stores keys in plaintext in `~/.dsh/.credentials.yaml`; the status
endpoint is unauthenticated on dsh 0.2.2-rc.5; billing is decided by your provider account, not by this plugin.

This is a small community project with no guaranteed response time.
