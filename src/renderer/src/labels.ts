import type { DemoStatus } from '../../shared/demo/types'
import type { Channel, Status, WebClass } from '../../shared/types'

export const STATUS_LABEL: Record<Status, string> = {
  new: 'Новое', written: 'Написали', replied: 'Ответили', demo_opened: 'Демо открыто',
  call: 'Звонок', deal: 'Сделка', refused: 'Отказ', later: 'Позже'
}
export const STATUS_ORDER = Object.keys(STATUS_LABEL) as Status[]

export const WEB_LABEL: Record<WebClass, string> = { none: 'Без сайта', social: 'Только соцсети', template: 'Шаблон', own: 'Свой сайт' }
export const WEB_ORDER: WebClass[] = ['none', 'social', 'template', 'own']

export const CHANNEL_LABEL: Record<Channel, { short: string; title: string }> = {
  telegram: { short: 'TG', title: 'Telegram' }, whatsapp: { short: 'WA', title: 'WhatsApp' }, viber: { short: 'VB', title: 'Viber' },
  instagram: { short: 'IG', title: 'Instagram' }, vk: { short: 'VK', title: 'ВКонтакте' }, max: { short: 'MX', title: 'MAX' },
  call: { short: 'Тел', title: 'Позвонить' }, sms: { short: 'SMS', title: 'SMS' }
}

export const DEMO_STATUS_LABEL: Record<DemoStatus, string> = {
  draft: 'Черновик', publishing: 'Публикуется…', published: 'Опубликовано', unpublished: 'Снято с публикации', error: 'Ошибка'
}
export const POSTCARD_HINT = 'Тёмный фон расходует много краски; печатайте на плотной бумаге'
