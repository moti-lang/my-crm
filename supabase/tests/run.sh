#!/usr/bin/env bash
# מריץ את כל חבילות הבדיקה מול הפוסטגרס המקומי.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
for suite in 02_rls_proof.sql 03_allocation_proof.sql; do
  echo "═══ $suite ═══"
  psql -h /tmp -p 5433 -U postgres -d teichtal -v ON_ERROR_STOP=1 -f "$DIR/$suite" 2>&1 \
    | grep -E '✓|✗|ERROR|═|עברו' | sed 's/^psql.*NOTICE:  //'
done
