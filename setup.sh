#!/bin/bash

# ================================================
# Timeline App - Quick Setup Script
# ================================================
# This script helps you set up the Timeline app
# for local development.

set -e

echo "================================================"
echo "Timeline App - Quick Setup"
echo "================================================"
echo ""

# Check if running from repo root
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the repository root"
    exit 1
fi

# Check Node.js version
echo "📋 Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Error: Node.js 20.x or higher is required"
    echo "   Current version: $(node -v)"
    echo "   Install from: https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js version: $(node -v)"
echo ""

# Enable corepack
echo "🔧 Enabling corepack..."
corepack enable
corepack prepare pnpm@9.15.9 --activate
echo "✅ pnpm configured"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found"
    read -p "Would you like to copy .env.example to .env? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp .env.example .env
        echo "✅ .env file created"
        echo "⚠️  IMPORTANT: Edit .env and fill in your values!"
        echo ""
    else
        echo "❌ Setup requires .env file. Exiting."
        exit 1
    fi
else
    echo "✅ .env file found"
    echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install
echo "✅ Dependencies installed"
echo ""

# Check if pnpm-lock.yaml was generated
if [ ! -f "pnpm-lock.yaml" ]; then
    echo "⚠️  Warning: pnpm-lock.yaml was not generated"
    echo "   This file is required for Vercel deployment"
else
    echo "✅ pnpm-lock.yaml generated"
fi
echo ""

# Check PostgreSQL
echo "🗄️  Checking PostgreSQL..."
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL is installed"
    
    # Try to create database
    read -p "Would you like to create the 'timeline' database? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if createdb timeline 2>/dev/null; then
            echo "✅ Database 'timeline' created"
        else
            echo "ℹ️  Database may already exist or PostgreSQL is not running"
        fi
    fi
else
    echo "⚠️  PostgreSQL not found"
    echo "   Install with:"
    echo "   - macOS: brew install postgresql@14 && brew services start postgresql@14"
    echo "   - Ubuntu: sudo apt install postgresql"
    echo "   - Windows: Download from https://www.postgresql.org/download/"
fi
echo ""

# Generate Prisma client
echo "🔨 Generating Prisma client..."
if pnpm db:generate; then
    echo "✅ Prisma client generated"
else
    echo "⚠️  Prisma generation failed - check DATABASE_URL in .env"
fi
echo ""

# Run migrations
echo "🚀 Running database migrations..."
if pnpm db:migrate; then
    echo "✅ Migrations complete"
else
    echo "⚠️  Migrations failed - check DATABASE_URL and ensure PostgreSQL is running"
fi
echo ""

# Summary
echo "================================================"
echo "Setup Complete! 🎉"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your API keys:"
echo "   - GOOGLE_OAUTH_CLIENT_ID"
echo "   - GOOGLE_OAUTH_CLIENT_SECRET"
echo "   - OPENAI_API_KEY"
echo "   - ENCRYPTION_KEY_BASE64 (generate with: openssl rand -base64 32)"
echo ""
echo "2. Start the development servers:"
echo "   Terminal 1: pnpm dev:api"
echo "   Terminal 2: pnpm dev:web"
echo ""
echo "3. Visit http://localhost:3000"
echo ""
echo "For deployment instructions, see DEPLOYMENT_GUIDE.md"
echo "================================================"
