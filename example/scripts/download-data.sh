#!/usr/bin/env bash
#
# Download clinical datasets from Kaggle and prepare unified patient data.
#
# Prerequisites:
#   1. Install Kaggle CLI: pipx install kaggle
#   2. Configure credentials: https://www.kaggle.com/settings → API → Create New Token
#      Save kaggle.json to ~/.kaggle/kaggle.json (chmod 600)
#      Or set KAGGLE_USERNAME and KAGGLE_KEY environment variables
#
# Usage:
#   ./scripts/download-data.sh
#
# Datasets downloaded:
#   - MIMIC-III Clinical Database Demo (asjad99/mimiciii)
#   - Real-time Patient Data with Oxygen Demand (dibyasankhapal/realtime-patient-data-with-oxygen-demand)
#   - Healthcare Dataset (prasad22/healthcare-dataset)
#   - Hematology CBC Dataset (ashlingovindasamy/hematology-complete-blood-count-dataset-mimic-iii)
#   - Global Blood Test Health Insights (kantesti/global-blood-test-health-insights-2025-2026)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$EXAMPLE_DIR/data"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for kaggle CLI
if ! command -v kaggle &> /dev/null; then
    log_error "Kaggle CLI not found. Install with: pipx install kaggle"
    exit 1
fi

# Verify kaggle authentication works
log_info "Verifying Kaggle authentication..."
if ! kaggle datasets list --max-size 1 &> /dev/null; then
    log_error "Kaggle authentication failed."
    echo ""
    echo "Option 1: Set environment variables"
    echo "  export KAGGLE_USERNAME=your_username"
    echo "  export KAGGLE_KEY=your_api_key"
    echo ""
    echo "Option 2: Create credentials file"
    echo "  1. Go to https://www.kaggle.com/settings"
    echo "  2. Click 'Create New Token' under API section"
    echo "  3. Save kaggle.json to ~/.kaggle/kaggle.json"
    echo "  4. chmod 600 ~/.kaggle/kaggle.json"
    exit 1
fi

# Create directories
mkdir -p "$DATA_DIR/mimic-iii"
mkdir -p "$DATA_DIR/source"
mkdir -p "$DATA_DIR/reference"

log_info "Downloading datasets to $DATA_DIR..."

# Download MIMIC-III
log_info "Downloading MIMIC-III Clinical Database Demo..."
kaggle datasets download -d asjad99/mimiciii --unzip -p "$DATA_DIR/mimic-iii" --force
# The dataset extracts to a subdirectory, move files up if needed
if [[ -d "$DATA_DIR/mimic-iii/mimic-iii-clinical-database-demo-1.4" ]]; then
    mv "$DATA_DIR/mimic-iii/mimic-iii-clinical-database-demo-1.4"/* "$DATA_DIR/mimic-iii/"
    rmdir "$DATA_DIR/mimic-iii/mimic-iii-clinical-database-demo-1.4"
fi

# Download Oxygen Dataset
log_info "Downloading Real-time Patient Data with Oxygen Demand..."
kaggle datasets download -d dibyasankhapal/realtime-patient-data-with-oxygen-demand --unzip -p "$DATA_DIR/source" --force

# Download Healthcare Dataset
log_info "Downloading Healthcare Dataset..."
kaggle datasets download -d prasad22/healthcare-dataset --unzip -p "$DATA_DIR/source" --force

# Download CBC Dataset
log_info "Downloading Hematology CBC Dataset..."
kaggle datasets download -d ashlingovindasamy/hematology-complete-blood-count-dataset-mimic-iii --unzip -p "$DATA_DIR/source" --force

# Download NHANES/Global Health Reference Data
log_info "Downloading Global Blood Test Health Insights (NHANES)..."
kaggle datasets download -d kantesti/global-blood-test-health-insights-2025-2026 --unzip -p "$DATA_DIR/reference" --force

log_info "All datasets downloaded successfully!"
echo ""

# Check for bun
if ! command -v bun &> /dev/null; then
    log_warn "Bun not found. Skipping data preparation."
    log_warn "Install bun and run:"
    log_warn "  cd $EXAMPLE_DIR && bun install"
    log_warn "  bun run scripts/derive-reference-ranges.ts"
    log_warn "  bun run scripts/prepare-dataset.ts"
    exit 0
fi

# Run preparation scripts
log_info "Running data preparation scripts..."

cd "$EXAMPLE_DIR"

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
    log_info "Installing dependencies..."
    bun install
fi

log_info "Deriving reference ranges from NHANES data..."
bun run scripts/derive-reference-ranges.ts

log_info "Preparing unified patient dataset..."
bun run scripts/prepare-dataset.ts

echo ""
log_info "Data preparation complete!"
echo ""
echo "Generated files:"
echo "  $DATA_DIR/reference-ranges.json (lab reference ranges)"
echo "  $DATA_DIR/patients.csv (unified patient records)"
echo ""
echo "Start the server with:"
echo "  cd $EXAMPLE_DIR && bun run src/server.ts"
