
ALTER TABLE linkedin_commenters DROP CONSTRAINT IF EXISTS linkedin_commenters_classification_check;
ALTER TABLE linkedin_commenters ADD CONSTRAINT linkedin_commenters_classification_check
  CHECK (classification IN ('prospect', 'not_prospect', 'partner', 'retired', 'pending_review', 'customer'));
