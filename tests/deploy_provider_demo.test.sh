#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
mkdir "$test_dir/fake-bin"
printf 'test key\n' > "$test_dir/key"
cat > "$test_dir/fake-bin/sftp" <<'SFTP'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$TEST_SFTP_ARGS"
cat > "$TEST_SFTP_BATCH"
SFTP
chmod +x "$test_dir/fake-bin/sftp"

export PODCAST_SFTP_HOST=sftp.example.test
export PODCAST_SFTP_USER=deployuser
export PODCAST_SFTP_PORT=22
export PODCAST_SFTP_KEY="$test_dir/key"
export PODCAST_SFTP_TARGET=/webroot/0815/podcast-provider-demo
export TEST_SFTP_ARGS="$test_dir/args"
export TEST_SFTP_BATCH="$test_dir/batch"
export PATH="$test_dir/fake-bin:$PATH"

bin/deploy-provider-demo --plan > "$test_dir/plan"
rg -q 'src/App.php' "$test_dir/plan"
test ! -e "$TEST_SFTP_BATCH"

bin/deploy-provider-demo --check > /dev/null
rg -q '^cd /webroot/0815/podcast-provider-demo$' "$TEST_SFTP_BATCH"
if rg -q '^put ' "$TEST_SFTP_BATCH"; then
  echo '--check attempted an upload' >&2
  exit 1
fi

bin/deploy-provider-demo --upload > /dev/null
test "$(rg -c '^put ' "$TEST_SFTP_BATCH")" -eq 10
for file in .htaccess catalog.php podcasts.php src/App.php src/Demo.php src/Rss.php src/bootstrap.php \
  audio/bewusst-hoeren.wav audio/willkommen.wav audio/zehn-sekunden.wav; do
  rg -q -F "put $file $file" "$TEST_SFTP_BATCH"
done
if rg -q 'config|router|README|generate_demo_audio' "$TEST_SFTP_BATCH"; then
  echo 'non-runtime file in upload batch' >&2
  exit 1
fi
rg -q -F -- '-oStrictHostKeyChecking=yes' "$TEST_SFTP_ARGS"
rg -q -F -- '-oPasswordAuthentication=no' "$TEST_SFTP_ARGS"

export PODCAST_SFTP_TARGET=/webroot/other
if bin/deploy-provider-demo --upload > /dev/null 2>&1; then
  echo 'unsafe target accepted' >&2
  exit 1
fi

echo 'Strato SFTP deploy selection and safeguards OK'
