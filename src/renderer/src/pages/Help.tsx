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
      </div>
    </main>
  )
}
