/**
 * Canonical display labels for UN/LOCODEs used in customer-facing text. Customer email text never
 * names a place in a draft — the code's label (or just the code) does. Names are factual location
 * names; extend deliberately.
 */
export const PORT_LABELS: Readonly<Record<string, string>> = {
  NLRTM: "Rotterdam", NLAMS: "Amsterdam", NLMOE: "Moerdijk", BEANR: "Antwerp", BEZEE: "Zeebrugge",
  DEHAM: "Hamburg", DEBRV: "Bremerhaven", DEDUI: "Duisburg", DECGN: "Cologne", FRLEH: "Le Havre",
  GBFXT: "Felixstowe", GBSOU: "Southampton", GBLGP: "London Gateway", ESVLC: "Valencia", ESALG: "Algeciras",
  ITGOA: "Genoa", ITSPE: "La Spezia", GRPIR: "Piraeus", PLGDN: "Gdańsk", PLMAL: "Małaszewicze",
  CNSHA: "Shanghai", CNNGB: "Ningbo", CNSZX: "Shenzhen", CNTAO: "Qingdao", CNXMN: "Xiamen", CNTSN: "Tianjin",
  CNXIY: "Xi'an", CNZGZ: "Zhengzhou", CNCKG: "Chongqing", HKHKG: "Hong Kong", SGSIN: "Singapore",
  MYPKG: "Port Klang", VNSGN: "Ho Chi Minh City", VNHPH: "Haiphong", THLCH: "Laem Chabang", INNSA: "Nhava Sheva",
  INMUN: "Mundra", KRPUS: "Busan", JPTYO: "Tokyo", JPYOK: "Yokohama", TWKHH: "Kaohsiung", IDJKT: "Jakarta",
  AEJEA: "Jebel Ali", SAJED: "Jeddah", EGPSD: "Port Said", ZADUR: "Durban", ZACPT: "Cape Town", ZAJNB: "Johannesburg",
  KEMBA: "Mombasa", NGLOS: "Lagos", BRSSZ: "Santos", BRRIG: "Rio Grande", BRPNG: "Paranaguá", ARBUE: "Buenos Aires",
  UYMVD: "Montevideo", CLSAI: "San Antonio", PECLL: "Callao", MXZLO: "Manzanillo", USNYC: "New York",
  USSAV: "Savannah", USCHS: "Charleston", USHOU: "Houston", USLAX: "Los Angeles", USLGB: "Long Beach",
  USOAK: "Oakland", USSEA: "Seattle", USCHI: "Chicago", CAVAN: "Vancouver", CAMTR: "Montreal", AUSYD: "Sydney",
  AUMEL: "Melbourne",
};

export function portLabel(unlocode: string): string {
  const name = PORT_LABELS[unlocode];
  return name ? `${name} (${unlocode})` : unlocode;
}
