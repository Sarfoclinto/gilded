/*
 * EVERY FACT ON THE WEBSITE LIVES HERE. Fill in each value marked TODO before the site goes live, then save; nothing else needs editing.
 * A value left as an empty string ('') is simply not shown (for example no WhatsApp number = no WhatsApp button).
 * Phone numbers: write them the way people should read them ('024 123 4567'); the links are made from the digits.
 */
window.SITE = {
  company: "Gilded Gold Enterprise",
  // One short line under the company name in search results and link previews.
  description:
    "Gilded Gold Enterprise buys gold in Ghana. Your gold is weighed in air and in water in front of you, priced at the day's rate and paid on the spot.",

  phone: "055 361 8944", // from the shop banner (+233 55 361 8944)
  phone2: "025 717 1391", // from the shop banner (+233 25 717 1391); '' to hide
  whatsapp: "055 361 8944", // TODO which number is on WhatsApp? with country code, digits only, e.g. '233553618944'
  email: "gildedgoldent@gmail.com", // TODO CHECK: the banner photo cuts it off after 'gmail.co'; later perhaps info@gildedgold.org (guide 12)
  hours: "Monday to Sunday, 7:00 to 18:30", // TODO usual opening hours, e.g. 'Monday to Saturday, 8:00 to 17:30'

  // TODO the licence line exactly as on the banner (the photo shows only 'LICENSED BY GH...'). Leave '' to hide it.
  licence: "",

  // About us: one or two short paragraphs in your own words (who you are, since when, where). Leave '' to hide the section.
  about: "", // TODO

  // TODO one entry per branch. Leave a field '' to hide it. mapUrl: open the place in Google Maps, Share, Copy link.
  branches: [
    {
      name: "Anyanso Branch",
      area: "Ashanti Region",
      address: "",
      hours: "",
      phone: "",
      mapUrl: "",
    }, // TODO street/landmark, hours, map link; add the other branches
  ],

  // Where staff sign in (the system). Shown small in the header and footer.
  appUrl: "https://app.gildedgold.org",
};
