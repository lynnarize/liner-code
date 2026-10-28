import Foundation
import Security

/// API keys live in the login keychain under "Liner Code"; the engine gets them in memory only.
enum Keychain {
    static let service = "Liner Code"
    static let accounts = ["key:anthropic", "key:openai"]

    static func set(_ account: String, _ value: String?) -> Bool {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return true }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ account: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Every key that's set, by provider ("anthropic"), for the engine at launch.
    static func all() -> [String: String] {
        var keys: [String: String] = [:]
        for a in accounts { if let v = get(a) { keys[String(a.dropFirst(4))] = v } }
        return keys
    }
}
