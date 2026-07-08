-- Post-load reconciliation — idempotent. Run after data loads so fresh installs
-- and re-loads end up matching the migrations (which run BEFORE the data exists):
--   * populate entities.county from the NYSED county code (BEDS first 2 digits)
--   * remove statewide/aggregate ("state") entities (facts cascade)
--   * remove county rollup entities (BEDS prefix + all zeros) that older
--     payloads mislabeled as districts (facts cascade)

UPDATE entities e
   SET county = c.name
  FROM (VALUES
    ('01','Albany'),('02','Allegany'),('03','Broome'),('04','Cattaraugus'),
    ('05','Cayuga'),('06','Chautauqua'),('07','Chemung'),('08','Chenango'),
    ('09','Clinton'),('10','Columbia'),('11','Cortland'),('12','Delaware'),
    ('13','Dutchess'),('14','Erie'),('15','Essex'),('16','Franklin'),
    ('17','Fulton'),('18','Genesee'),('19','Greene'),('20','Hamilton'),
    ('21','Herkimer'),('22','Jefferson'),('23','Lewis'),('24','Livingston'),
    ('25','Madison'),('26','Monroe'),('27','Montgomery'),('28','Nassau'),
    ('31','New York'),('32','Bronx'),('33','Kings'),('34','Queens'),
    ('35','Richmond'),('40','Niagara'),('41','Oneida'),('42','Onondaga'),
    ('43','Ontario'),('44','Orange'),('45','Orleans'),('46','Oswego'),
    ('47','Otsego'),('48','Putnam'),('49','Rensselaer'),('50','Rockland'),
    ('51','Saint Lawrence'),('52','Saratoga'),('53','Schenectady'),
    ('54','Schoharie'),('55','Schuyler'),('56','Seneca'),('57','Steuben'),
    ('58','Suffolk'),('59','Sullivan'),('60','Tioga'),('61','Tompkins'),
    ('62','Ulster'),('63','Warren'),('64','Washington'),('65','Wayne'),
    ('66','Westchester'),('67','Wyoming'),('68','Yates')
  ) AS c(code, name)
 WHERE left(e.beds_code, 2) = c.code
   AND e.county IS DISTINCT FROM c.name;

DELETE FROM entities WHERE type = 'state';

-- County rollups misclassified as districts by older payloads. NYSED encodes
-- them two ways, both whole-county aggregates:
--   "NN0000000000" — county prefix + zeros (e.g. "580000000000", "County: X")
--   "0000NN000000" — county-summary form (e.g. "000001000000", "X County")
-- Real districts carry a non-zero district number, so none are caught here.
DELETE FROM entities WHERE beds_code ~ '^([0-9]{2}0{10}|0000[0-9]{2}0{6})$';
