export default function SettingsPage() {
  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">设置</h1>
          <div className="text-sm text-text-secondary mt-1">占位页面（Phase 2：可接入 ws/账号/配置导入等）</div>
        </div>
      </div>

      <div className="bg-surface border border-border-muted rounded-2xl p-6 text-sm text-text-secondary">
        这里放置设置项：WS 连接地址、默认账号、缓存策略等。
      </div>
    </div>
  )
}

