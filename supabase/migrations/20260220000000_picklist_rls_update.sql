-- Picklist RLS Policy Update
-- Repurposes event_picklist.picklist JSONB column as embedded entries store.
-- Updates RLS policies to reflect correct permission semantics:
--   public:  all auth users can view; scouters + admins (picklist.view) can edit/delete
--   default: scouters + admins (picklist.view) can view; admins only (picklist.write) can edit/delete
--   private: creator only can view/edit/delete

-- Drop existing policies
DROP POLICY IF EXISTS "Event picklist: Enable select for users based on uid" ON event_picklist;
DROP POLICY IF EXISTS "Event picklist: Enable update for users based on uid" ON event_picklist;
DROP POLICY IF EXISTS "Event picklist: Enable insert for users based on uid" ON event_picklist;
DROP POLICY IF EXISTS "Event picklist: Enable delete for users based on uid" ON event_picklist;

-- SELECT: public = everyone authenticated; default = picklist.view (scouter+admin); private = creator only
CREATE POLICY "Event picklist: Select"
  ON event_picklist AS permissive FOR SELECT TO public
  USING (
    (type = 'public') OR
    ((select auth.uid()) = uid::uuid) OR
    (type = 'default' AND authorize('picklist.view'))
  );

-- INSERT: creator must match authenticated user;
--         default type additionally requires picklist.write (admin only)
CREATE POLICY "Event picklist: Insert"
  ON event_picklist AS permissive FOR INSERT TO public
  WITH CHECK (
    (select auth.uid()) = uid::uuid AND (
      type != 'default' OR authorize('picklist.write')
    )
  );

-- UPDATE: public = picklist.view (scouter+admin); default = picklist.write (admin); private = creator
CREATE POLICY "Event picklist: Update"
  ON event_picklist AS permissive FOR UPDATE TO public
  USING (
    ((select auth.uid()) = uid::uuid) OR
    (type = 'public' AND authorize('picklist.view')) OR
    (type = 'default' AND authorize('picklist.write'))
  )
  WITH CHECK (
    ((select auth.uid()) = uid::uuid) OR
    (type = 'public' AND authorize('picklist.view')) OR
    (type = 'default' AND authorize('picklist.write'))
  );

-- DELETE: same as UPDATE
CREATE POLICY "Event picklist: Delete"
  ON event_picklist AS permissive FOR DELETE TO public
  USING (
    ((select auth.uid()) = uid::uuid) OR
    (type = 'public' AND authorize('picklist.view')) OR
    (type = 'default' AND authorize('picklist.write'))
  );
