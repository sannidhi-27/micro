export const summaryLanguages = [
  { code: 'eng_Latn', name: 'English', nativeName: 'English', locale: 'en-IN' },
  { code: 'asm_Beng', name: 'Assamese', nativeName: 'অসমীয়া', locale: 'as-IN' },
  { code: 'ben_Beng', name: 'Bengali', nativeName: 'বাংলা', locale: 'bn-IN' },
  { code: 'brx_Deva', name: 'Bodo', nativeName: 'बड़ो', locale: 'brx-IN', modelSupported: false },
  { code: 'doi_Deva', name: 'Dogri', nativeName: 'डोगरी', locale: 'doi-IN', modelSupported: false },
  { code: 'guj_Gujr', name: 'Gujarati', nativeName: 'ગુજરાતી', locale: 'gu-IN' },
  { code: 'hin_Deva', name: 'Hindi', nativeName: 'हिन्दी', locale: 'hi-IN' },
  { code: 'kan_Knda', name: 'Kannada', nativeName: 'ಕನ್ನಡ', locale: 'kn-IN' },
  { code: 'kas_Arab', name: 'Kashmiri', nativeName: 'कॉशुर', locale: 'ks-IN' },
  { code: 'gom_Deva', name: 'Konkani', nativeName: 'कोंकणी', locale: 'kok-IN', modelSupported: false },
  { code: 'mai_Deva', name: 'Maithili', nativeName: 'मैथिली', locale: 'mai-IN' },
  { code: 'mal_Mlym', name: 'Malayalam', nativeName: 'മലയാളം', locale: 'ml-IN' },
  { code: 'mni_Beng', name: 'Manipuri', nativeName: 'ꯃꯤꯇꯩꯂꯣꯟ', locale: 'mni-IN' },
  { code: 'mar_Deva', name: 'Marathi', nativeName: 'मराठी', locale: 'mr-IN' },
  { code: 'npi_Deva', name: 'Nepali', nativeName: 'नेपाली', locale: 'ne-IN' },
  { code: 'ory_Orya', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', locale: 'or-IN' },
  { code: 'pan_Guru', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', locale: 'pa-IN' },
  { code: 'san_Deva', name: 'Sanskrit', nativeName: 'संस्कृतम्', locale: 'sa-IN' },
  { code: 'sat_Beng', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ', locale: 'sat-IN' },
  { code: 'snd_Arab', name: 'Sindhi', nativeName: 'سنڌي', locale: 'sd-IN' },
  { code: 'tam_Taml', name: 'Tamil', nativeName: 'தமிழ்', locale: 'ta-IN' },
  { code: 'tel_Telu', name: 'Telugu', nativeName: 'తెలుగు', locale: 'te-IN' },
  { code: 'urd_Arab', name: 'Urdu', nativeName: 'اردو', locale: 'ur-IN' },
]

export function languageForCode(code) {
  return summaryLanguages.find((language) => language.code === code) || summaryLanguages[0]
}
