export interface HomeInventoryItem {
  itemKey: string
  area: string
  name: string
  note: string
}

export const HOME_INVENTORY_ITEMS: HomeInventoryItem[] = [
  {
    itemKey: 'kitchen',
    area: 'מטבח',
    name: 'מטבח',
    note: 'לנקות משטחי עבודה, כיריים ורצפה. להשאיר את אזור הכיור יבש בסיום.',
  },
  {
    itemKey: 'kitchen-sink',
    area: 'מטבח',
    name: 'כיור מטבח',
    note: 'יש לבדוק שאין סתימה, לנקות מסננת ולייבש את הארון מתחת לכיור.',
  },
  {
    itemKey: 'kitchen-window',
    area: 'מטבח',
    name: 'חלון מטבח',
    note: 'החלון קצת שבור. צריך לפתוח ולסגור אותו בזהירות ולא להפעיל כוח.',
  },
  {
    itemKey: 'fridge',
    area: 'מטבח',
    name: 'מקרר',
    note: 'לזרוק מזון שפג תוקפו, לנגב מדפים ולהחזיר פריטים לקופסאות סגורות.',
  },
  {
    itemKey: 'stove',
    area: 'מטבח',
    name: 'כיריים',
    note: 'להמתין שהכיריים יתקררו לפני ניקוי. לבדוק שהגז סגור בסיום.',
  },
  {
    itemKey: 'living-room',
    area: 'סלון',
    name: 'סלון',
    note: 'לסדר כריות, לשאוב שטיח ולפנות כוסות/צלחות שנשארו באזור.',
  },
  {
    itemKey: 'living-room-window',
    area: 'סלון',
    name: 'חלון סלון',
    note: 'לנקות מסילה לפני פתיחה מלאה. אם יש קושי בתנועה, לדווח לפני שממשיכים.',
  },
  {
    itemKey: 'bathroom',
    area: 'שירותים ומקלחת',
    name: 'שירותים',
    note: 'לנקות אסלה, כיור ורצפה. להשאיר חלון פתוח לאוורור אחרי ניקוי.',
  },
  {
    itemKey: 'shower',
    area: 'שירותים ומקלחת',
    name: 'מקלחת',
    note: 'לנקות זכוכית וניקוז. לבדוק שאין הצטברות מים ליד הדלת.',
  },
  {
    itemKey: 'bathroom-sink',
    area: 'שירותים ומקלחת',
    name: 'כיור אמבטיה',
    note: 'לנקות אבנית סביב הברז ולבדוק שהניקוז יורד מהר.',
  },
  {
    itemKey: 'washing-machine',
    area: 'שירות',
    name: 'מכונת כביסה',
    note: 'להשאיר דלת פתוחה אחרי שימוש, לנקות פילטר רק כשהמכונה כבויה.',
  },
  {
    itemKey: 'entrance',
    area: 'כניסה',
    name: 'כניסה לבית',
    note: 'לטאטא, לפנות נעליים מהמעבר ולוודא שהדלת ננעלת חלק.',
  },
]

export function findHomeInventoryItem(itemId: string) {
  return HOME_INVENTORY_ITEMS.find((item) => item.itemKey === itemId) ?? null
}
