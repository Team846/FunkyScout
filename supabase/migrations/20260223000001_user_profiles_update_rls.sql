-- Allow users with profiles.write permission (admins) to update any user profile.
-- Required for scouter rating writes from the desktop app (admin sets ratings on scout profiles).
CREATE POLICY "User profiles: Allow profiles.write to update"
  ON user_profiles
  AS permissive
  FOR UPDATE
  TO authenticated
  USING (authorize('profiles.write'))
  WITH CHECK (authorize('profiles.write'));
