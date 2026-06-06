use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::time::Duration;

use ironrdp_connector::sspi::network_client::{NetworkClient, NetworkProtocol};
use ironrdp_connector::sspi::{Error, ErrorKind, Result as SspiResult};
use ironrdp_connector::sspi::generator::NetworkRequest;
use url::Url;

const KDC_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Default)]
pub struct SimpleNetworkClient;

impl SimpleNetworkClient {
    fn send_tcp(&self, url: &Url, data: &[u8]) -> SspiResult<Vec<u8>> {
        let addr = format!("{}:{}", url.host_str().unwrap_or_default(), url.port().unwrap_or(88));
        let addrs = addr
            .to_socket_addrs()
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;

        let mut last_err = Error::new(
            ErrorKind::NoAuthenticatingAuthority,
            "no KDC addresses to connect to".to_owned(),
        );
        let mut connected = None;
        for addr in addrs {
            match TcpStream::connect_timeout(&addr, KDC_CONNECT_TIMEOUT) {
                Ok(s) => {
                    connected = Some(s);
                    break;
                }
                Err(e) => {
                    last_err = Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}"));
                }
            }
        }
        let mut stream = connected.ok_or(last_err)?;

        stream
            .write_all(data)
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;

        let mut len_buf = [0u8; 4];
        stream
            .read_exact(&mut len_buf)
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;
        let len = u32::from_be_bytes(len_buf) as usize;

        let mut buf = vec![0u8; len + 4];
        buf[0..4].copy_from_slice(&len_buf);
        stream
            .read_exact(&mut buf[4..])
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;

        Ok(buf)
    }

    fn send_udp(&self, url: &Url, data: &[u8]) -> SspiResult<Vec<u8>> {
        let udp_socket = UdpSocket::bind(("127.0.0.1", 0))
            .map_err(|e| Error::new(ErrorKind::InternalError, format!("{e:?}")))?;
        udp_socket
            .set_read_timeout(Some(KDC_CONNECT_TIMEOUT))
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;

        let addr = format!("{}:{}", url.host_str().unwrap_or_default(), url.port().unwrap_or(88));
        udp_socket
            .send_to(data, addr)
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;

        let mut buf = vec![0u8; 0xbb80];
        let n = udp_socket
            .recv(&mut buf)
            .map_err(|e| Error::new(ErrorKind::NoAuthenticatingAuthority, format!("{e:?}")))?;

        let mut reply_buf = Vec::with_capacity(n + 4);
        reply_buf.extend_from_slice(&(n as u32).to_be_bytes());
        reply_buf.extend_from_slice(&buf[..n]);

        Ok(reply_buf)
    }

    fn send_http(&self, url: &Url, data: &[u8]) -> SspiResult<Vec<u8>> {
        let response = ureq::post(url.as_str())
            .set("Content-Type", "application/octet-stream")
            .send_bytes(data)
            .map_err(|err| {
                let msg = format!("Unable to send the data to the KDC Proxy: {err:?}");
                Error::new(ErrorKind::NoAuthenticatingAuthority, msg)
            })?;

        let mut body = Vec::new();
        response
            .into_reader()
            .read_to_end(&mut body)
            .map_err(|err| {
                Error::new(
                    ErrorKind::NoAuthenticatingAuthority,
                    format!("Unable to read the response data from the KDC Proxy: {err:?}"),
                )
            })?;

        Ok(body)
    }
}

impl NetworkClient for SimpleNetworkClient {
    fn send(&self, request: &NetworkRequest) -> SspiResult<Vec<u8>> {
        match request.protocol {
            NetworkProtocol::Tcp => self.send_tcp(&request.url, &request.data),
            NetworkProtocol::Udp => self.send_udp(&request.url, &request.data),
            NetworkProtocol::Http | NetworkProtocol::Https => self.send_http(&request.url, &request.data),
        }
    }
}
