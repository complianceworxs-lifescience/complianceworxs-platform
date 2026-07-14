-- Backfill primary_authorization_domain across all warm_outbound_staging contacts
-- Five-tier heuristic: specific keyword → QA leadership → general QA → soft quality/compliance → non-fit (NULL)

UPDATE warm_outbound_staging
SET primary_authorization_domain = CASE
  -- TIER 1: SPECIFIC KEYWORD MATCHES
  WHEN job_title ILIKE '%capa%' THEN 'capa'
  
  WHEN job_title ILIKE '%batch release%' 
    OR job_title ILIKE '%batch disposition%' 
    OR job_title ILIKE '%disposition%' 
    OR job_title ILIKE '%product release%'
    OR job_title ILIKE '%batch record%' THEN 'batch_release'
  
  WHEN job_title ILIKE '%validation%' 
    OR job_title ILIKE '% csv%' 
    OR job_title ILIKE 'csv %' 
    OR job_title ILIKE '%computer system validation%'
    OR job_title ILIKE '%cqv%'
    OR job_title ILIKE '%cv specialist%' THEN 'change_control'
  
  WHEN job_title ILIKE '%deviation%' 
    OR job_title ILIKE '%nonconformance%' 
    OR job_title ILIKE '%non-conformance%'
    OR (job_title ILIKE '%investigation%' AND job_title NOT ILIKE '%clinical investigation%') THEN 'deviation'
  
  WHEN job_title ILIKE '%change control%' 
    OR job_title ILIKE '%change management%' 
    OR job_title ILIKE '%change request%' THEN 'change_control'
  
  WHEN job_title ILIKE '%data integrity%' 
    OR job_title ILIKE '%alcoa%' 
    OR job_title ILIKE '%21 cfr 11%' 
    OR job_title ILIKE '%part 11%' 
    OR job_title ILIKE '%document control%' 
    OR job_title ILIKE '%documentation%' THEN 'data_integrity'
  
  WHEN job_title ILIKE '%complaint%' 
    OR job_title ILIKE '%mdr %' 
    OR job_title ILIKE '% mdr%' 
    OR job_title ILIKE '%vigilance%' 
    OR job_title ILIKE '%post-market%' 
    OR job_title ILIKE '%post market%' 
    OR job_title ILIKE '%pms %' THEN 'complaint'
  
  WHEN job_title ILIKE '%supplier qualification%' 
    OR job_title ILIKE '%supplier quality%' 
    OR job_title ILIKE '%vendor quality%' 
    OR job_title ILIKE '%vendor management%'
    OR job_title ILIKE '%external quality%' THEN 'supplier_qualification'
  
  WHEN job_title ILIKE '%visual inspection%' 
    OR job_title ILIKE '%inspection coordinator%' 
    OR job_title ILIKE '%fill finish%'
    OR job_title ILIKE '%fill/finish%' THEN 'visual_inspection'
  
  WHEN job_title ILIKE '%sterile%' 
    OR job_title ILIKE '%microbiology%' 
    OR job_title ILIKE '%aseptic%' 
    OR job_title ILIKE '%503b%' 
    OR job_title ILIKE '%compounding%' 
    OR job_title ILIKE '%bud %' 
    OR job_title ILIKE '%beyond use%' THEN 'bud'
  
  WHEN job_title ILIKE '%oos%' 
    OR job_title ILIKE '%oot%' 
    OR job_title ILIKE '%out of specification%' 
    OR job_title ILIKE '%lab manager%' 
    OR job_title ILIKE '%analytical%'
    OR job_title ILIKE '%qc %' 
    OR job_title ILIKE '% qc%'
    OR job_title ILIKE '%quality control%'
    OR job_title ILIKE '%stability%' THEN 'oos_oot'
  
  WHEN job_title ILIKE '%regulatory affairs%' 
    OR job_title ILIKE '%regulatory submission%' 
    OR job_title ILIKE '%regulatory compliance%' 
    OR job_title ILIKE '%submission%' 
    OR job_title ILIKE '%dossier%' THEN 'change_control'

  -- TIER 4: NON-FITS — wrong vertical or wrong function (stays NULL)
  -- Placed early so executives don't fall through to "manager" matches
  WHEN job_title ILIKE '%chief executive%' 
    OR job_title ILIKE '%ceo%'
    OR job_title ILIKE '%chief operations%' 
    OR job_title ILIKE '%coo%'
    OR job_title ILIKE '%cfo%'
    OR job_title ILIKE '%cto%'
    OR job_title ILIKE '%cio%'
    OR job_title ILIKE '%director of finance%' 
    OR job_title ILIKE '%director, finance%'
    OR job_title ILIKE '%director, it%' 
    OR job_title ILIKE '%it director%'
    OR job_title ILIKE '%director, it r&d%'
    OR job_title ILIKE '%sales%' 
    OR job_title ILIKE '%marketing%' 
    OR job_title ILIKE '%business development%'
    OR job_title ILIKE '%recruiter%'
    OR job_title ILIKE '%talent%'
    OR job_title ILIKE '%ehs %' 
    OR job_title ILIKE '%clinical research%' 
    OR job_title ILIKE '%gcp%' 
    OR job_title ILIKE '%clinical trial%'
    OR job_title ILIKE '%senior requirements engineer%' THEN NULL
  
  -- TIER 2: QA LEADERSHIP → batch_release (universal QA leader pain)
  WHEN job_title ILIKE '%head of quality%' 
    OR job_title ILIKE '%vp quality%' 
    OR job_title ILIKE '%vp, quality%' 
    OR job_title ILIKE '%vice president%quality%'
    OR job_title ILIKE '%vice-president%quality%' 
    OR job_title ILIKE '%chief quality%'
    OR job_title ILIKE '%qa director%' 
    OR job_title ILIKE '%director of quality%' 
    OR job_title ILIKE '%director, quality%' 
    OR job_title ILIKE '%director quality%'
    OR job_title ILIKE '%head qa%' 
    OR job_title ILIKE '%head, qa%' 
    OR job_title ILIKE '%head of qa%'
    OR job_title ILIKE '%plant manager%'  -- plant managers own batch release in practice
    OR job_title ILIKE '%site head%'
    OR job_title ILIKE '%corporate quality%' THEN 'batch_release'
  
  -- TIER 3: GENERAL QA → batch_release default
  WHEN job_title ILIKE '%quality assurance%' 
    OR job_title ILIKE '%qa manager%' 
    OR job_title ILIKE '%qa specialist%' 
    OR job_title ILIKE '%qa engineer%' 
    OR job_title ILIKE '%qa associate%'
    OR job_title ILIKE '%qa lead%'
    OR job_title ILIKE 'qa %'
    OR job_title ILIKE '% qa %'
    OR job_title ILIKE '% qa'
    OR job_title ILIKE '%quality manager%' 
    OR job_title ILIKE '%quality engineer%'
    OR job_title ILIKE '%quality systems%'
    OR job_title ILIKE '%quality specialist%'
    OR job_title ILIKE '%quality lead%'
    OR job_title ILIKE '%quality compliance%' 
    OR job_title ILIKE '%manager%quality%' 
    OR job_title ILIKE '%manager, quality%'
    OR job_title ILIKE '%associate manager - quality%'
    OR job_title ILIKE '%principal quality%' THEN 'batch_release'
  
  -- TIER 5: SOFT MATCHES — compliance/auditor/GMP titles → batch_release default
  WHEN job_title ILIKE '%gmp%' 
    OR job_title ILIKE '%cgmp%' 
    OR job_title ILIKE '%auditor%' 
    OR job_title ILIKE '%compliance manager%'
    OR job_title ILIKE '%compliance director%'
    OR job_title ILIKE '%director of compliance%'
    OR job_title ILIKE '%director compliance%'
    OR job_title ILIKE '%compliance analyst%'
    OR job_title ILIKE '%compliance specialist%'
    OR job_title ILIKE '%continuous improvement quality%' 
    OR job_title ILIKE '%us quality and continuous improvement%'
    OR job_title ILIKE '%clinical quality%rac%' THEN 'batch_release'
  
  -- Final fallback: stays NULL for manual review
  ELSE NULL
END
WHERE job_title IS NOT NULL;