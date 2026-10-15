CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 2000),
  picture TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private','friends')),
  stats_visibility TEXT NOT NULL DEFAULT 'public' CHECK(stats_visibility IN ('public','private','friends')),
  games_visibility TEXT NOT NULL DEFAULT 'public' CHECK(games_visibility IN ('public','private','friends')),
  friends_visibility TEXT NOT NULL DEFAULT 'private' CHECK(friends_visibility IN ('public','private','friends'))
);
CREATE TABLE friendships (
  requester TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
  PRIMARY KEY(requester, recipient),
  CHECK(requester != recipient)
);
CREATE UNIQUE INDEX friendship_pair ON friendships(min(requester,recipient),max(requester,recipient));
CREATE INDEX friendship_recipient ON friendships(recipient,status);
