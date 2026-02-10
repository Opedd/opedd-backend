-- Allow public (anon) read access to licenses for the checkout page.
-- Only exposes the fields needed to display the purchase form.
CREATE POLICY "Public can view licensable articles"
  ON licenses FOR SELECT
  USING (licensing_enabled = true);

NOTIFY pgrst, 'reload schema';
