export interface DemoLabels {
  menu: string; services: string; hours: string; reviews: string; about: string; address: string
  fromGoogle: string; photoBy: string; badge: string; want: string; nick: string
  call: string; route: string; book: string; reviewsWord: string
}

export const labels: Record<'ru' | 'uk', DemoLabels> = {
  ru: {
    menu: 'Меню', services: 'Услуги', hours: 'Часы работы', reviews: 'Отзывы', about: 'О нас', address: 'Адрес',
    fromGoogle: 'Отзывы из Google', photoBy: 'Фото', badge: 'Сайт сделал', want: 'Хочу так', nick: 'ваш_ник',
    call: 'Позвонить', route: 'Как добраться', book: 'Записаться', reviewsWord: 'отзывов'
  },
  uk: {
    menu: 'Меню', services: 'Послуги', hours: 'Години роботи', reviews: 'Відгуки', about: 'Про нас', address: 'Адреса',
    fromGoogle: 'Відгуки з Google', photoBy: 'Фото', badge: 'Сайт зробив', want: 'Хочу так', nick: 'ваш_нік',
    call: 'Зателефонувати', route: 'Як дістатися', book: 'Записатися', reviewsWord: 'відгуків'
  }
}
