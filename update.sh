#!/bin/bash
#
# SparseTree Update Script
#
# Updates the application to the latest version from the main branch,
# installs dependencies, runs migrations, and restarts services.
#
# Usage: ./update.sh [options]
#
# Options:
#   --no-restart    Skip PM2 restart
#   --dry-run       Preview what would be done
#   --branch=NAME   Pull from specific branch (default: main)
#   --help          Show this help message
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
NO_RESTART=false
DRY_RUN=false
BRANCH="main"

for arg in "$@"; do
  case $arg in
    --no-restart)
      NO_RESTART=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --branch=*)
      BRANCH="${arg#*=}"
      shift
      ;;
    --help|-h)
      echo "SparseTree Update Script"
      echo ""
      echo "Usage: ./update.sh [options]"
      echo ""
      echo "Options:"
      echo "  --no-restart    Skip PM2 restart"
      echo "  --dry-run       Preview what would be done"
      echo "  --branch=NAME   Pull from specific branch (default: main)"
      echo "  --help          Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./update.sh                    # Update from main, restart services"
      echo "  ./update.sh --no-restart       # Update but don't restart PM2"
      echo "  ./update.sh --branch=dev       # Update from dev branch"
      echo "  ./update.sh --dry-run          # Preview what would happen"
      exit 0
      ;;
  esac
done

# Get script directory (where SparseTree is installed)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  SparseTree Update Script${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Function to run or preview commands
run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY-RUN]${NC} Would run: $*"
  else
    echo -e "${GREEN}Running:${NC} $*"
    "$@"
  fi
}

# Check for uncommitted changes
echo -e "${BLUE}Step 1:${NC} Checking git status..."
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo -e "${YELLOW}Warning:${NC} You have uncommitted changes."
  echo "Please commit or stash your changes before updating."
  git status --short
  exit 1
fi
echo -e "${GREEN}✓${NC} Working directory clean"
echo ""

# Fetch and pull latest
echo -e "${BLUE}Step 2:${NC} Pulling latest from ${BRANCH}..."
run_cmd git fetch origin
run_cmd git checkout "$BRANCH"
run_cmd git pull --rebase --autostash origin "$BRANCH"
echo -e "${GREEN}✓${NC} Code updated"
echo ""

# Get version info
CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo -e "Current version: ${GREEN}${CURRENT_VERSION}${NC}"
echo ""

# Install dependencies
echo -e "${BLUE}Step 3:${NC} Installing dependencies..."
run_cmd npm install
echo -e "${GREEN}✓${NC} Dependencies installed"
echo ""

# Build the application
echo -e "${BLUE}Step 4:${NC} Building application..."
run_cmd npm run build
echo -e "${GREEN}✓${NC} Application built"
echo ""

# Run data migrations
echo -e "${BLUE}Step 5:${NC} Running data migrations..."
if [ "$DRY_RUN" = true ]; then
  run_cmd npx tsx scripts/migrate.ts --dry-run
else
  run_cmd npx tsx scripts/migrate.ts
fi
echo -e "${GREEN}✓${NC} Migrations complete"
echo ""

# Restart PM2 services
if [ "$NO_RESTART" = false ]; then
  echo -e "${BLUE}Step 6:${NC} Restarting services..."
  if command -v pm2 &> /dev/null; then
    if [ -f "ecosystem.config.cjs" ]; then
      run_cmd pm2 restart ecosystem.config.cjs
    elif [ -f "ecosystem.config.js" ]; then
      run_cmd pm2 restart ecosystem.config.js
    else
      echo -e "${YELLOW}Warning:${NC} No ecosystem.config.cjs found, skipping PM2 restart"
    fi
  else
    echo -e "${YELLOW}Warning:${NC} PM2 not found, skipping service restart"
  fi
  echo -e "${GREEN}✓${NC} Services restarted"
else
  echo -e "${YELLOW}Skipping${NC} service restart (--no-restart flag)"
fi
echo ""

# Final status
echo -e "${BLUE}================================${NC}"
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}DRY RUN COMPLETE${NC}"
  echo "No changes were made. Run without --dry-run to apply updates."
else
  echo -e "${GREEN}UPDATE COMPLETE${NC}"
  echo -e "SparseTree is now running version ${GREEN}${CURRENT_VERSION}${NC}"
fi
echo -e "${BLUE}================================${NC}"
