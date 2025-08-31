# CI/CD Setup

This repository uses GitHub Actions for continuous integration and automated releases.

## Workflows

### CI Workflow (`ci.yml`)
Runs on every push and pull request to ensure code quality:
- **Testing**: Runs tests on Node.js 18.x and 20.x
- **Linting**: Checks code style with Biome
- **Type Checking**: Ensures TypeScript types are correct
- **Building**: Verifies packages build successfully
- **Format Check**: Ensures consistent code formatting

### Release Workflow (`release.yml`)
Runs on pushes to `main` branch for automated releases:
- Uses [Changesets](https://github.com/changesets/changesets) for version management
- Creates release PRs automatically
- Publishes to npm when release PRs are merged
- Enables npm package provenance for security

## Setup Requirements

### 1. GitHub Secrets
Add these secrets to your GitHub repository:
- `NPM_TOKEN`: Your npm automation token for publishing
  - Get it from https://www.npmjs.com/settings/[your-username]/tokens
  - Create a token with "Automation" type

### 2. GitHub Settings
- Enable "Allow GitHub Actions to create and approve pull requests" in:
  Settings → Actions → General → Workflow permissions

### 3. NPM Setup
Each package that should be published needs:
- `"publishConfig": { "access": "public" }` in package.json
- Proper `"files"` array listing what to include
- Built output before publishing

## Local Development

### Creating a Changeset
When you make changes that should be released:
```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages have changed
2. Choose the type of change (major/minor/patch)
3. Write a description of the changes

### Version Packages Locally
To see what versions would be bumped:
```bash
pnpm version-packages
```

### Manual Release (Emergency Only)
If automated release fails:
```bash
pnpm release
```

## How It Works

1. **Development**: Make changes and create changesets
2. **PR**: Push changes with changeset files
3. **Merge**: When PR is merged to main, the Release workflow runs
4. **Version PR**: Changesets creates a PR with version bumps
5. **Release**: When version PR is merged, packages are published to npm

## Troubleshooting

### CI Failures
- Check the specific job that failed in the Actions tab
- Common issues:
  - Lint errors: Run `pnpm lint:biome:fix`
  - Format errors: Run `pnpm format`
  - Type errors: Run `pnpm typecheck` locally
  - Test failures: Run `pnpm test` locally

### Release Failures
- Ensure NPM_TOKEN is set correctly
- Check that package.json has correct publishConfig
- Verify you have npm publish permissions for the scope