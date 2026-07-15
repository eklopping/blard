# cursor workspace

Game monorepo lives in [`skilling-mmo/`](skilling-mmo/README.md).

## Push to GitHub

Create a repo on GitHub, then from this directory:

```bash
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

On the VM, clone the repo and set `APP_DIR` to the nested project path:

```bash
git clone git@github.com:<owner>/<repo>.git /opt/skilling-mmo-repo
export APP_DIR=/opt/skilling-mmo-repo/skilling-mmo
```

See [skilling-mmo/README.md](skilling-mmo/README.md) for local dev and deploy details.
