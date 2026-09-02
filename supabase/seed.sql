-- seed.sql — נתוני פיתוח. רץ אוטומטית ב-`supabase db reset`.
-- מזהים קבועים כדי שה-reset יהיה דטרמיניסטי וניתן להשוואה.

-- ═══════════════════════ משתמשים ═══════════════════════
-- אין כאן משתמשים בכוונה. כתיבה ישירה ל-auth.users מייצרת משתמשים
-- שלא מתחברים (חסרה שורה ב-auth.identities), והסכמה משתנה בין גרסאות GoTrue.
-- המשתמשים נוצרים דרך ה-Admin API:   node scripts/seed-users.mjs
-- הסקריפט גם כותב profiles, משייך branch_staff וממלא created_by.

-- ═══════════════════════ עונה ═══════════════════════
insert into seasons (id, name, starts_on, ends_on, is_current) values
  ('aaaaaaaa-0000-0000-0000-000000000001','תשפ״ז 2026/27',current_date - 90, current_date + 210, true);

-- ═══════════════════════ סניפים ═══════════════════════
insert into branches (id, name, city, address, supervisor_name, supervisor_phone,
                      schedule_text, weekdays, lesson_time, default_tuition, monthly_rent) values
  ('bbbbbbbb-0000-0000-0000-000000000001','ביתר עילית','ביתר עילית','הרב שך 12','מירי גולדשטיין','972541000001','ראשון ורביעי 16:30','{0,3}','16:30',2000,1200),
  ('bbbbbbbb-0000-0000-0000-000000000002','מודיעין עילית','מודיעין עילית','נתיבות המשפט 5','חני רוזנברג','972541000002','שני 17:00','{1}','17:00',2000,1100),
  ('bbbbbbbb-0000-0000-0000-000000000003','ירושלים רמות','ירושלים','רמות ב 44','שירי אלבוים','972541000003','שלישי 16:00','{2}','16:00',2200,1500),
  ('bbbbbbbb-0000-0000-0000-000000000004','בית שמש','בית שמש','נהר הירדן 8','אסתי כהן','972541000004','רביעי 17:30','{3}','17:30',1900,900),
  ('bbbbbbbb-0000-0000-0000-000000000005','אשדוד','אשדוד','רובע ז 21','דבורי מזרחי','972541000005','חמישי 16:30','{4}','16:30',1800,850);

-- שיוך רבקי לביתר עילית נעשה ב-scripts/seed-users.mjs (תלוי ב-UUID מה-Admin API).

-- ═══════════════════════ קטגוריות ═══════════════════════
insert into categories (scope, kind, name, sort_order) values
  ('branch','expense','שכירות אולם',1),('branch','expense','שכר מדריכה',2),
  ('branch','expense','הגברה ותאורה',3),('branch','expense','תלבושות',4),
  ('branch','expense','תפאורה',5),('branch','expense','ציוד מתכלה',6),
  ('branch','expense','פרסום מקומי',7),('branch','expense','הסעות',8),
  ('branch','expense','ניקיון',9),('branch','expense','כיבוד',10),('branch','expense','אחר',11),
  ('general','expense','פרסום ארצי',1),('general','expense','הנהלת חשבונות',2),
  ('general','expense','אתר ומערכות',3),('general','expense','אירוע סוף שנה',4),
  ('general','expense','ייעוץ',5),('general','expense','אחר',6),
  ('general','income','תשלומי תלמידות',1),('general','income','כרטיסים להצגה',2),
  ('general','income','מכירת תלבושות',3),('general','income','חסויות',4),
  ('general','income','מכירת עותקים',5),('general','income','אחר',6),
  ('branch','income','כרטיסים להצגה',1),('branch','income','מכירת תלבושות',2),('branch','income','אחר',3),
  ('production','expense','צלם',1),('production','expense','עריכה',2),
  ('production','expense','מוזיקה',3),('production','expense','תפאורה',4),
  ('production','expense','תלבושות ואיפור',5),('production','expense','אולם צילום',6),
  ('production','expense','הסעות',7),('production','expense','כיבוד',8),
  ('production','expense','שכפול והפצה',9),('production','expense','פרסום',10),
  ('production','income','מכירת עותקים',1),('production','income','כרטיסים להצגה',2),('production','income','חסויות',3);

-- ═══════════════════════ תלמידות ═══════════════════════
insert into students (id, season_id, branch_id, full_name, grade, parent_name, parent_phone,
                      status, tuition_total, discount, discount_reason, installments,
                      photo_consent, source, joined_on, stopped_on, stop_reason, notes) values
 ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','שירה כהן','ד','רחלי כהן','972521000001','active',2000,0,null,3,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','מלכי ברגר','ה','שיפי ברגר','972521000002','active',2000,200,'אחות שנייה',3,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','אסתי וייס','ד','מירי וייס','972521000003','active',2000,0,null,3,false,'manual',current_date - 88,null,null,'ללא אישור צילום'),
 ('dddddddd-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','חני שטרן','ו','טובי שטרן','972521000004','active',2000,0,null,1,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','ריקי לוינגר','ה','דבורי לוינגר','972521000005','active',2000,0,null,3,true,'manual',current_date - 90,null,null,'לא מגיעה לאחרונה'),
 ('dddddddd-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','טובי גרוס','ד','חיה גרוס','972521000006','pending',2000,0,null,3,false,'whatsapp',current_date - 81,null,null,'ליד מוואטסאפ'),
 ('dddddddd-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','שרי פרידמן','ה','נחמי פרידמן','972522000001','active',2000,0,null,2,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','בתיה הרשקוביץ','ו','רבקי הרשקוביץ','972522000002','active',2000,0,null,3,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','נעמי דויטש','ד','שרי דויטש','972522000003','active',2000,0,null,3,true,'manual',current_date - 89,null,null,null),
 ('dddddddd-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','יעלי אונגר','ה','חני אונגר','972522000004','active',2000,0,null,1,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000011','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','אדל רוזנפלד','ו','מלכי רוזנפלד','972523000001','active',2200,0,null,2,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000012','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','חוי גולדברג','ד','אסתי גולדברג','972523000002','active',2200,300,'מצב כלכלי',3,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000013','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','מירי סגל','ה','רחלי סגל','972523000003','active',2200,0,null,3,true,'manual',current_date - 87,null,null,null),
 ('dddddddd-0000-0000-0000-000000000014','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','רוחי אפשטיין','ו','שרה אפשטיין','972523000004','stopped',2200,0,null,3,true,'manual',current_date - 90,current_date - 15,'עברה עיר',null),
 ('dddddddd-0000-0000-0000-000000000015','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000004','יוכי מנדלסון','ד','ברכי מנדלסון','972524000001','active',1900,0,null,2,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000016','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000004','שיפי בן דוד','ה','אורלי בן דוד','972524000002','active',1900,0,null,3,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000017','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000004','דינה אזולאי','ו','סימי אזולאי','972524000003','active',1900,0,null,3,true,'manual',current_date - 86,null,null,null),
 ('dddddddd-0000-0000-0000-000000000018','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000004','רבקי טאובר','ד','גילי טאובר','972524000004','active',1900,0,null,1,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000019','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000005','חיילי עמר','ה','רויטל עמר','972525000001','active',1800,0,null,2,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000020','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000005','ספירה נחום','ד','ליאת נחום','972525000002','active',1800,0,null,3,true,'manual',current_date - 90,null,null,null),
 ('dddddddd-0000-0000-0000-000000000021','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000005','תמר ביטון','ו','מיכל ביטון','972525000003','active',1800,0,null,3,true,'manual',current_date - 89,null,null,null);

-- ═══════════════════════ תשלומים ═══════════════════════
-- שילמו במלואו / חלקית / כלל לא — כדי שהגבייה והדשבורד יראו טווח אמיתי.
insert into payments (student_id, paid_on, amount, method, covers_note) values
 ('dddddddd-0000-0000-0000-000000000001',current_date - 86,700,'transfer','תשלום 1 מתוך 3'),
 ('dddddddd-0000-0000-0000-000000000001',current_date - 55,700,'transfer','תשלום 2 מתוך 3'),
 ('dddddddd-0000-0000-0000-000000000001',current_date - 22,600,'bit','תשלום 3 מתוך 3'),
 ('dddddddd-0000-0000-0000-000000000002',current_date - 84,900,'bit','תשלום 1'),
 ('dddddddd-0000-0000-0000-000000000004',current_date - 89,2000,'transfer','תשלום מלא מראש'),
 ('dddddddd-0000-0000-0000-000000000005',current_date - 83,700,'cash','תשלום 1 מתוך 3'),
 ('dddddddd-0000-0000-0000-000000000007',current_date - 87,1000,'transfer','תשלום 1 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000007',current_date - 23,1000,'transfer','תשלום 2 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000008',current_date - 85,800,'bit','תשלום 1 מתוך 3'),
 ('dddddddd-0000-0000-0000-000000000010',current_date - 90,2000,'check','תשלום מלא'),
 ('dddddddd-0000-0000-0000-000000000011',current_date - 88,1100,'transfer','תשלום 1 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000011',current_date - 24,1100,'transfer','תשלום 2 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000012',current_date - 82,600,'cash','תשלום 1'),
 ('dddddddd-0000-0000-0000-000000000014',current_date - 86,800,'transfer','שולם לפני ההפסקה'),
 ('dddddddd-0000-0000-0000-000000000015',current_date - 89,950,'bit','תשלום 1 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000015',current_date - 25,950,'bit','תשלום 2 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000016',current_date - 25,600,'cash','תשלום 1 מתוך 3'),
 ('dddddddd-0000-0000-0000-000000000018',current_date - 90,1900,'transfer','תשלום מלא'),
 ('dddddddd-0000-0000-0000-000000000019',current_date - 88,900,'transfer','תשלום 1 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000019',current_date - 24,900,'transfer','תשלום 2 מתוך 2'),
 ('dddddddd-0000-0000-0000-000000000020',current_date - 45,500,'bit','תשלום 1 מתוך 3');

-- ═══════════════════════ הוצאות סניף (14) ═══════════════════════
insert into ledger_entries (season_id, kind, scope, branch_id, entry_date, category, vendor, description, amount, method, is_recurring, recurring_day, created_by)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'expense', 'branch', b, current_date - d, c, v, ds, a, m, r, rd, null
from (values
 ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 80, 'שכירות אולם','מתנ״ס ביתר','שכירות ספטמבר',1200,'transfer'::payment_method,true,5),
 ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 50, 'שכירות אולם','מתנ״ס ביתר','שכירות אוקטובר',1200,'transfer'::payment_method,true,5),
 ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 75, 'שכר מדריכה','מירי גולדשטיין','ספטמבר',2800,'transfer'::payment_method,true,1),
 ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 40, 'תלבושות','אולפני תפארת','תלבושות להצגה',860,'bit'::payment_method,false,null),
 ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 20, 'הגברה ותאורה','סאונד פלוס','השכרת מערכת',450,'cash'::payment_method,false,null),
 ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 80, 'שכירות אולם','אולם בית יעקב','שכירות ספטמבר',1100,'transfer'::payment_method,true,5),
 ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 70, 'שכר מדריכה','חני רוזנברג','ספטמבר',2600,'transfer'::payment_method,true,1),
 ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 30, 'ציוד מתכלה','אופיס דיפו','אביזרי במה',320,'cash'::payment_method,false,null),
 ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, 80, 'שכירות אולם','מרכז רמות','שכירות ספטמבר',1500,'transfer'::payment_method,true,5),
 ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, 65, 'שכר מדריכה','שירי אלבוים','ספטמבר',3000,'transfer'::payment_method,true,1),
 ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, 25, 'תפאורה','נגריית אבנר','רקע לבמה',1240,'transfer'::payment_method,false,null),
 ('bbbbbbbb-0000-0000-0000-000000000004'::uuid, 80, 'שכירות אולם','אולם שמשון','שכירות ספטמבר',900,'transfer'::payment_method,true,5),
 ('bbbbbbbb-0000-0000-0000-000000000004'::uuid, 35, 'פרסום מקומי','דפוס בית שמש','פליירים',380,'cash'::payment_method,false,null),
 ('bbbbbbbb-0000-0000-0000-000000000005'::uuid, 80, 'שכירות אולם','מתנ״ס רובע ז','שכירות ספטמבר',850,'transfer'::payment_method,true,5)
) as x(b,d,c,v,ds,a,m,r,rd);

-- ═══════════════ כספים כלליים — שיטות חלוקה שונות ═══════════════
insert into ledger_entries (season_id, kind, scope, entry_date, category, vendor, description, amount, method, split_method, split_manual, created_by) values
 ('aaaaaaaa-0000-0000-0000-000000000001','expense','general', current_date - 60,'פרסום ארצי','קמפיין מדיה','קמפיין רישום',6000,'transfer','equal',       null,null),
 ('aaaaaaaa-0000-0000-0000-000000000001','expense','general', current_date - 45,'הנהלת חשבונות','שרה לוי','ריטיינר רבעוני',3600,'transfer','by_students', null,null),
 ('aaaaaaaa-0000-0000-0000-000000000001','expense','general', current_date - 30,'אתר ומערכות','ספק תוכנה','מערכת ניהול',2400,'credit','manual',
   '{"bbbbbbbb-0000-0000-0000-000000000001":0.3,"bbbbbbbb-0000-0000-0000-000000000002":0.2,"bbbbbbbb-0000-0000-0000-000000000003":0.2,"bbbbbbbb-0000-0000-0000-000000000004":0.15,"bbbbbbbb-0000-0000-0000-000000000005":0.15}'::jsonb,
   null),
 ('aaaaaaaa-0000-0000-0000-000000000001','expense','general', current_date - 20,'ייעוץ','עו״ד כהן','ייעוץ משפטי',1800,'transfer','none',        null,null),
 ('aaaaaaaa-0000-0000-0000-000000000001','income','general',  current_date - 35,'חסויות','קרן קהילתית','חסות שנתית',5000,'transfer','none',     null,null);

-- ═══════════════════════ הפקות ═══════════════════════
insert into productions (id, name, year, status, budget, release_date, notes) values
 ('eeeeeeee-0000-0000-0000-000000000001','הלב שבחלון','תשפ״ז','editing', 45000, null,'בעריכה, יציאה מתוכננת בחנוכה'),
 ('eeeeeeee-0000-0000-0000-000000000002','הדרך הביתה','תשפ״ו','released',38000, current_date - 200,'הופץ, רווחי'),
 ('eeeeeeee-0000-0000-0000-000000000003','קול הדממה','תשפ״ה','released',30000, current_date - 500,'הופץ, רווחי');

insert into ledger_entries (season_id, kind, scope, production_id, entry_date, category, vendor, description, amount, method, created_by)
select 'aaaaaaaa-0000-0000-0000-000000000001', k::entry_kind, 'production', p, current_date - d, c, v, ds, a, m::payment_method, null
from (values
 ('eeeeeeee-0000-0000-0000-000000000001'::uuid,'expense',70,'צלם','אולפני אור','ימי צילום',12000,'transfer'),
 ('eeeeeeee-0000-0000-0000-000000000001'::uuid,'expense',40,'עריכה','סטודיו נועם','עריכה ראשונית',7500,'transfer'),
 ('eeeeeeee-0000-0000-0000-000000000001'::uuid,'expense',35,'תלבושות ואיפור','אולפני תפארת','תלבושות',4200,'bit'),
 ('eeeeeeee-0000-0000-0000-000000000002'::uuid,'expense',210,'צלם','אולפני אור','ימי צילום',11000,'transfer'),
 ('eeeeeeee-0000-0000-0000-000000000002'::uuid,'expense',205,'שכפול והפצה','דפוס מרכז','הפצה',3800,'transfer'),
 ('eeeeeeee-0000-0000-0000-000000000002'::uuid,'income', 195,'מכירת עותקים','—','מכירות',34000,'bit'),
 ('eeeeeeee-0000-0000-0000-000000000002'::uuid,'income', 180,'כרטיסים להצגה','—','ערב הקרנה',12500,'cash'),
 ('eeeeeeee-0000-0000-0000-000000000003'::uuid,'expense',510,'צלם','אולפני אור','ימי צילום',9000,'transfer'),
 ('eeeeeeee-0000-0000-0000-000000000003'::uuid,'income', 495,'מכירת עותקים','—','מכירות',28000,'bit'),
 ('eeeeeeee-0000-0000-0000-000000000003'::uuid,'income', 480,'חסויות','קרן קהילתית','חסות',6000,'transfer')
) as x(p,k,d,c,v,ds,a,m);

-- משתתפות — רק תלמידות עם אישור צילום (הטריגר חוסם אחרת)
insert into production_cast (production_id, student_id, role_name) values
 ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','תפקיד ראשי'),
 ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002','תפקיד משנה'),
 ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000011','תפקיד משנה'),
 ('eeeeeeee-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000004','תפקיד ראשי'),
 ('eeeeeeee-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000015','מקהלה');

-- ═══════════════════ נוכחות — 4 שבועות אחורה ═══════════════════
insert into lessons (branch_id, lesson_date, status, reported_at, reported_by)
select b.id, current_date - w, 'reported', now() - (w || ' days')::interval, b.supervisor_name
from branches b, unnest(array[28,21,14,7]) as w;

-- שיעור אחד היום שלא דווח — הבאנר האדום בדשבורד תלוי בו.
insert into lessons (branch_id, lesson_date, status)
values ('bbbbbbbb-0000-0000-0000-000000000001', current_date, 'pending');

insert into attendance (lesson_id, student_id, mark)
select l.id, s.id, 'present'
from lessons l
join students s on s.branch_id = l.branch_id and s.status = 'active' and s.deleted_at is null
where l.status = 'reported';

-- ריקי לוינגר — שלוש היעדרויות רצופות (מפעיל את התראת הנשירה).
update attendance a set mark = 'absent'
from lessons l
where a.lesson_id = l.id
  and a.student_id = 'dddddddd-0000-0000-0000-000000000005'
  and l.lesson_date in (current_date - 21, current_date - 14, current_date - 7);

-- קישורי נוכחות לכל סניף
insert into attendance_links (branch_id, token)
select id, encode(gen_random_bytes(16),'hex') from branches;

-- ═══════════════════════ תבניות הודעה (7) ═══════════════════════
insert into message_templates (key, name, body, kind) values
 ('debt_reminder','תזכורת חוב','היי {parent_name}, תזכורת קטנה — נותרה יתרה של {balance} עבור {student_name} בסניף {branch}. אפשר להעביר בביט או בהעברה, תודה רבה 🌸','debt'),
 ('followup','מעקב אחרי פנייה','היי {parent_name}, מדברים מהחוג של הניה טייכטל. ביקשת שנחזור אלייך — נשמח לשמוע מה החלטתם 😊','followup'),
 ('lesson_cancel','ביטול שיעור','הודעה להורים: השיעור בסניף {branch} בתאריך {lesson_date} מבוטל. נעדכן על מועד חלופי.','general'),
 ('absence_alert','התראת היעדרות','היי {parent_name}, שמנו לב ש{student_name} לא הגיעה לשלושה שיעורים אחרונים. הכל בסדר? נשמח לדעת.','attendance'),
 ('owner_daily','סיכום יומי לבעלים','סיכום היום: נוכחות דווחה ב-{reported}/{total} סניפים · נכנסו {income} · {new_leads} פניות חדשות · {debtors} חייבות בסך {debt}.','owner_summary'),
 ('owner_weekly','סיכום שבועי לבעלים','סיכום שבועי: נגבו {income} · נותרו {debt} מ-{debtors} תלמידות · {unanswered} שאלות ממתינות לתשובה.','owner_summary'),
 ('supervisor_nudge','תזכורת לאחראית','היי {parent_name}, עדיין לא דיווחת נוכחות לשיעור של היום בסניף {branch}. הקישור: {link}','attendance');

-- ═══════════════════════ מאגר שאלות (10) ═══════════════════════
insert into faq_entries (question, answer, keywords) values
 ('כמה עולה החוג?','המחירים משתנים לפי סניף ומספר התשלומים. אשמח להעביר אותך להניה שתיתן לך את כל הפרטים 🙏','{מחיר,עלות,כמה,תשלום,שכר לימוד}'),
 ('באילו סניפים החוג פועל?','החוג פועל בביתר עילית, מודיעין עילית, ירושלים רמות, בית שמש ואשדוד.','{סניף,סניפים,איפה,מיקום,עיר}'),
 ('לאילו גילאים החוג מיועד?','החוג מיועד לבנות מכיתה ג עד כיתה ח, בקבוצות לפי גיל.','{גיל,גילאים,כיתה,מתאים}'),
 ('באילו ימים ושעות מתקיימים השיעורים?','כל סניף בימים ובשעות משלו. תגידי לי איזה סניף מעניין אותך ואשמח לפרט 😊','{ימים,שעות,מתי,לוח זמנים}'),
 ('איך נרשמים?','נשמח לרשום אותך! אשאל כמה פרטים קצרים ונתקדם מכאן.','{הרשמה,להירשם,רישום,איך נרשמים}'),
 ('יש הצגה או סרט בסוף השנה?','כן! בכל שנה מתקיימת הצגה, ובנוסף מופק סרט שהבנות משתתפות בו.','{הצגה,סרט,סוף שנה,הפקה}'),
 ('אפשר שיעור ניסיון?','בהחלט, אפשר להגיע לשיעור ניסיון אחד. אעביר להניה לתיאום 🙏','{ניסיון,לנסות,שיעור ראשון}'),
 ('יש הנחה לאחות שנייה?','יש הסדרים למשפחות עם יותר מבת אחת. הניה תשמח לדבר איתך על זה.','{הנחה,אחות,שתי בנות,אחיות}'),
 ('מה צריך להביא לשיעור?','בגדים נוחים לתנועה ובקבוק מים. התלבושות להצגה מסופקות דרך החוג.','{להביא,ציוד,בגדים,תלבושת}'),
 ('אפשר להצטרף באמצע השנה?','אפשר להצטרף גם באמצע השנה, בכפוף למקום בקבוצה. אעביר להניה לבדיקה.','{באמצע,להצטרף,מאוחר,עכשיו}');

insert into unanswered_questions (phone, question) values
 ('972521000099','יש חוג גם לבנים?'),
 ('972521000098','אפשר לשלם בכרטיס אשראי בתשלומים?');

-- ═══════════════════════ מספרים מורשים (3) ═══════════════════════
insert into authorized_numbers (phone, label, scope, branch_id, can_delete) values
 ('972501234567','הניה (אישי)','all', null, true),
 ('972533333333','שרה — הנהלת חשבונות','finance', null, false),
 ('972521111111','רבקי — ביתר עילית','branch','bbbbbbbb-0000-0000-0000-000000000001', false);

-- ═══════════════════════ חגי תשפ״ז ═══════════════════════
insert into holidays (day, name) values
 ('2026-09-12','ראש השנה א'),('2026-09-13','ראש השנה ב'),('2026-09-21','יום כיפור'),
 ('2026-09-26','סוכות א'),('2026-10-03','שמחת תורה'),('2026-12-05','חנוכה א'),
 ('2027-03-23','פורים'),('2027-04-22','פסח א'),('2027-04-28','שביעי של פסח'),
 ('2027-05-21','שבועות');

-- ═══════════════════════ הגדרות ═══════════════════════
insert into settings (key, value) values
 ('quiet_hours','{"from":"21:30","to":"08:00","no_shabbat":true}'),
 ('debt_reminder_days','[30,60,90]'),
 ('attendance_nudge_minutes','120'),
 ('absence_alert_streak','3'),
 ('agent_may_quote_prices','false'),
 ('owner_phone','"972501234567"'),
 ('daily_summary_time','"21:00"'),
 ('weekly_summary_day','0'),
 ('command_confirm_threshold','0');
