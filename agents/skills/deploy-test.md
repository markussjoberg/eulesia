# description: Deploy a branch to test.eulesia.org via GitHub Actions

## Usage

```
/deploy-test [branch-name]
```

If no branch is given, deploys the current branch.

## Workflow

1. **Determine the branch to deploy.**

   ```bash
   BRANCH="${1:-$(git branch --show-current)}"
   echo "Deploying branch: $BRANCH"
   ```

2. **Ensure branch is pushed to origin.**

   ```bash
   git push origin "$BRANCH" 2>/dev/null || true
   ```

3. **Trigger the deploy-test workflow on upstream.**

   ```bash
   gh workflow run deploy-test.yml --repo Eulesia/eulesia --ref "$BRANCH"
   ```

   If the workflow doesn't exist yet on upstream, inform the user they need to merge the `deploy-test.yml` workflow first.

4. **Monitor the deployment.**

   ```bash
   sleep 5
   gh run list --repo Eulesia/eulesia --workflow deploy-test.yml --limit 1
   ```

   Then watch with:
   ```bash
   RUN_ID=$(gh run list --repo Eulesia/eulesia --workflow deploy-test.yml --limit 1 --json databaseId -q '.[0].databaseId')
   gh run watch "$RUN_ID" --repo Eulesia/eulesia
   ```

5. **Report result.**

   Once complete, report whether deployment succeeded and provide the test URL: https://test.eulesia.org
