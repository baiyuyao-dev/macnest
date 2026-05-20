use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

const ENCRYPTION_KEY_ENV: &str = "MACOPS_ENCRYPTION_KEY";

/// 获取或生成加密密钥（存储在 Tauri plugin-store 中）
/// 这里使用简化方案：基于机器特征的派生密钥
fn get_or_create_key() -> [u8; 32] {
    // 使用 hostname + username 派生固定密钥
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "macops-default".to_string());

    // 检查环境变量是否提供了密钥
    if let Ok(key_b64) = std::env::var(ENCRYPTION_KEY_ENV) {
        if let Ok(bytes) = B64.decode(&key_b64) {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes[..32]);
            return key;
        }
    }

    // 从 hostname 派生 32 字节密钥
    let mut key = [0u8; 32];
    let source = format!("macops-encryption-key-{}", hostname);
    let source_bytes = source.as_bytes();
    for (i, k) in key.iter_mut().enumerate() {
        *k = source_bytes.get(i % source_bytes.len()).copied().unwrap_or(0);
    }
    key
}

/// 加密敏感数据
pub fn encrypt(plaintext: &str) -> anyhow::Result<String> {
    let key = get_or_create_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("加密失败: {}", e))?;
    // nonce(12字节) + ciphertext 编码为 base64
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(&combined))
}

/// 解密数据
pub fn decrypt(encrypted: &str) -> anyhow::Result<String> {
    let key = get_or_create_key();
    let combined = B64
        .decode(encrypted)
        .map_err(|e| anyhow::anyhow!("Base64 解码失败: {}", e))?;
    if combined.len() < 12 {
        anyhow::bail!("加密数据格式错误");
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("解密失败: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| anyhow::anyhow!("{}", e))
}

/// 加密后的凭据数据（存储在数据库中）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedAuthData {
    /// 凭据类型: "password" 或 "publickey"
    pub auth_type: String,
    /// 加密后的凭据数据
    pub encrypted: String,
}

impl EncryptedAuthData {
    pub fn new_password(password: &str) -> anyhow::Result<Self> {
        Ok(Self {
            auth_type: "password".to_string(),
            encrypted: encrypt(password)?,
        })
    }

    pub fn new_publickey(key_path: &str, passphrase: Option<&str>) -> anyhow::Result<Self> {
        let data = serde_json::json!({
            "key_path": key_path,
            "passphrase": passphrase.unwrap_or(""),
        });
        Ok(Self {
            auth_type: "publickey".to_string(),
            encrypted: encrypt(&data.to_string())?,
        })
    }

    pub fn decrypt_password(&self) -> anyhow::Result<String> {
        decrypt(&self.encrypted)
    }

    pub fn decrypt_publickey(&self) -> anyhow::Result<(String, Option<String>)> {
        let json = decrypt(&self.encrypted)?;
        let data: serde_json::Value = serde_json::from_str(&json)?;
        let key_path = data["key_path"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let passphrase = data["passphrase"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        Ok((key_path, passphrase))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let original = "my-secret-password";
        let encrypted = encrypt(original).unwrap();
        let decrypted = decrypt(&encrypted).unwrap();
        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_encrypted_auth_data_password() {
        let data = EncryptedAuthData::new_password("test-pass").unwrap();
        assert_eq!(data.auth_type, "password");
        let password = data.decrypt_password().unwrap();
        assert_eq!(password, "test-pass");
    }

    #[test]
    fn test_encrypted_auth_data_publickey() {
        let data = EncryptedAuthData::new_publickey("/path/to/key", Some("passphrase")).unwrap();
        assert_eq!(data.auth_type, "publickey");
        let (key_path, passphrase) = data.decrypt_publickey().unwrap();
        assert_eq!(key_path, "/path/to/key");
        assert_eq!(passphrase, Some("passphrase".to_string()));
    }
}
