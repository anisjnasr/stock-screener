-- Run this in the Supabase SQL Editor to create the profile tables.
-- These tables store user-specific data (watchlists, scans, settings).
-- Market/screener data stays in the local SQLite screener.db.

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  pin TEXT NOT NULL DEFAULT '0000',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE watchlist_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  symbols TEXT[] DEFAULT '{}',
  folder_id UUID REFERENCES watchlist_folders(id) ON DELETE SET NULL,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE screen_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE saved_screens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  universe TEXT DEFAULT 'all',
  type TEXT DEFAULT 'filter',
  filters JSONB DEFAULT '{}',
  script_body TEXT,
  folder_id UUID REFERENCES screen_folders(id) ON DELETE SET NULL,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE stock_flags (
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  symbol TEXT NOT NULL,
  flag TEXT NOT NULL CHECK (flag IN ('red','yellow','green','blue')),
  PRIMARY KEY (profile_id, symbol)
);

CREATE TABLE user_settings (
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (profile_id, key)
);

-- Index for fast profile lookup by username
CREATE INDEX idx_profiles_username ON profiles (username);
