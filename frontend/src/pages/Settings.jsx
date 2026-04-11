import { Settings as SettingsIcon } from 'lucide-react'

const Settings = () => (
  <div className="max-w-2xl space-y-4">
    <div className="card p-8 flex flex-col items-center text-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 border border-primary-100">
        <SettingsIcon size={22} className="text-primary-500" />
      </div>
      <h2 className="text-lg font-bold text-slate-800">Settings</h2>
      <p className="text-sm text-slate-500">Account and application settings coming soon.</p>
    </div>
  </div>
)

export default Settings
