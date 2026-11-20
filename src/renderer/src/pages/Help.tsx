export function Help(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-2xl px-8 py-8">
      <h1 className="mb-6 text-2xl font-bold">Помощь</h1>
      <div className="flex flex-col gap-4 text-sm leading-relaxed">
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 font-semibold">Что делает программа</h2>
          <p className="text-muted">Находит местные заведения без сайта (или только с соцсетями), помогает выбрать лучшие и написать им первое сообщение. Вы сами решаете, кому и что отправлять.</p>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 font-semibold">Откуда данные</h2>
          <p className="text-muted">Карты и категории — OpenStreetMap. Если вы добавили ключ Google, часть карточек уточняется через Google Places: сайт, рейтинг, телефон. Сайт заведения проверяется программой напрямую.</p>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 font-semibold">Powered by Google</h2>
          <p className="text-muted">Данные, полученные из Google Places, принадлежат Google и показываются в соответствии с условиями сервиса. Powered by Google.</p>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="mb-1 font-semibold">Программа сама ничего не отправляет</h2>
          <p className="text-muted">Сообщения уходят только когда вы нажимаете «Написать» и отправляете их в мессенджере сами. Ключи хранятся на вашем компьютере в зашифрованном виде и наружу не передаются.</p>
        </section>
        <section aria-labelledby="help-demo" className="rounded-card border border-line bg-surface p-5">
          <h2 id="help-demo" className="mb-1 font-semibold">Демо-сайты: настройка за 10 минут</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted">
            <li>
              Создайте публичный репозиторий:{' '}
              <a className="break-all font-mono text-fg underline" href="https://github.com/new?name=leadly-demos&visibility=public" target="_blank" rel="noreferrer">github.com/new?name=leadly-demos&amp;visibility=public</a>
            </li>
            <li>
              Создайте fine-grained токен GitHub (Settings → Developer settings → Fine-grained tokens) только на этот репозиторий.
              Права: <code className="font-mono text-fg">Contents</code>, <code className="font-mono text-fg">Pages</code>, <code className="font-mono text-fg">Administration</code> — Read and write;{' '}
              <code className="font-mono text-fg">Metadata</code> — Read. Вставьте его в Настройки → Демо-сайты и нажмите «Настроить GitHub».
              Если GitHub не дал включить Pages, включите вручную: Settings → Pages → Deploy from branch → main / root.
            </li>
            <li>
              Создайте токен Cloudflare (My Profile → API Tokens) с правами <code className="font-mono text-fg">Workers Scripts: Edit</code>,{' '}
              <code className="font-mono text-fg">D1: Edit</code>, <code className="font-mono text-fg">Account Settings: Read</code>. Вставьте его и нажмите «Настроить Worker».
              Если нет поддомена workers.dev, создайте его в панели Cloudflare → Workers & Pages.
            </li>
            <li>Укажите ник Telegram: на него ведёт кнопка «Хочу так». Нажмите «Проверить» — обе строки должны быть с ✓.</li>
          </ol>
          <h3 className="mt-4 mb-1 font-semibold">Что важно знать</h3>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
            <li>Отзывы и фото Google: условия Google Maps Platform не разрешают публиковать их на сторонних сайтах — за это могут заблокировать ключ. Под ними в демо стоят подписи авторов и «Отзывы из Google», лишние выключите в редакторе. Риск остаётся, лучше заменить их своими.</li>
            <li>Авторские права на фото: фото на картах загружают посетители и владельцы. Без разрешения их использование — нарушение (ГК РФ ст. 1301, компенсация от 10 тыс. до 5 млн ₽). Показывайте их только в черновике для владельца, а перед продажей сайта замените фото владельца.</li>
            <li>Репозиторий публичный: демо видит любой, у кого есть ссылка. Телефон ИП — персональные данные; в демо попадает только тот, что бизнес сам публикует на картах. «Снять с публикации» удаляет файлы из ветки, но в истории git копия остаётся. Чтобы стереть её совсем, удалите репозиторий на GitHub, создайте его заново с тем же именем, нажмите «Настроить GitHub» и опубликуйте нужные демо ещё раз.</li>
          </ul>
        </section>
      </div>
    </main>
  )
}
