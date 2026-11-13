import { HEART } from './heart-policy';
import { MOONFOX } from './moonfox-policy';
import { SPIRIT_PUP } from './spirit-pup-policy';
import { COSMIC_ENCORE } from './cosmic-encore-policy';
import { BIG_TIER_GIFTS } from './big-tier-gifts';

export const DAILY_REWARD = 25;
export const PRODUCTS: readonly never[] = [];
export const GIFTS = [
  { id: "good-vibes", name: "Good vibes", cost: 5 },
  { id: "big-love", name: "Big love", cost: 10 },
  { id: "standing-ovation", name: "Standing ovation", cost: 25 },
  HEART,
  SPIRIT_PUP,
  MOONFOX,
  COSMIC_ENCORE,
  ...BIG_TIER_GIFTS,
] as const;
const codes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const names = new Intl.DisplayNames(["en"], { type: "region" });
export const COUNTRIES = codes.map(code => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
export const COUNTRY_CODES = new Set(codes);
