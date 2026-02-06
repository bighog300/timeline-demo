#!/usr/bin/env bash
set -euo pipefail

today="$(date +%Y-%m-%d)"

cat <<EOF_INNER
## ${today}
### Added
- 

### Changed
- 

### Fixed
- 
EOF_INNER
