package br.com.lojadasargamassas.caruaru;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.Charset;
import java.text.Normalizer;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Impressão do cupom em impressora térmica Bluetooth (ESC/POS).
 *
 * O WebView não fala Bluetooth, então o JavaScript monta o texto já formatado
 * na largura do papel e esta ponte cuida de conectar e imprimir. A impressão
 * roda fora da thread do JavaScript — conectar pode levar segundos e travaria
 * a tela — e o resultado volta por `window.__impressoraAndroid`.
 */
public class PonteImpressora {

    /** Perfil de porta serial: o que praticamente toda térmica Bluetooth usa. */
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final MainActivity atividade;
    private final WebView webView;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService fila = Executors.newSingleThreadExecutor();

    PonteImpressora(MainActivity atividade, WebView webView) {
        this.atividade = atividade;
        this.webView = webView;
    }

    /* ---------------- Chamadas do JavaScript ---------------- */

    @JavascriptInterface
    public boolean disponivel() {
        return adaptador() != null;
    }

    /** Impressoras já pareadas. O pareamento é feito nas configurações do Android. */
    @JavascriptInterface
    public String listar() {
        JSONArray saida = new JSONArray();
        BluetoothAdapter adaptador = adaptador();
        if (adaptador == null || !temPermissao()) return saida.toString();
        try {
            for (BluetoothDevice d : adaptador.getBondedDevices()) {
                JSONObject item = new JSONObject();
                item.put("nome", d.getName() == null ? d.getAddress() : d.getName());
                item.put("endereco", d.getAddress());
                saida.put(item);
            }
        } catch (SecurityException | org.json.JSONException e) {
            return saida.toString();
        }
        return saida.toString();
    }

    /**
     * Enfileira a impressão e devolve na hora — o resultado chega depois pelo
     * callback, para a tela não congelar enquanto a impressora conecta.
     */
    @JavascriptInterface
    public void imprimir(String id, String endereco, String texto, boolean semAcentos) {
        if (!temPermissao()) {
            principal.post(atividade::pedirBluetooth);
            responder(id, false, "Permissão de Bluetooth necessária. Autorize e tente de novo.");
            return;
        }
        fila.execute(() -> {
            try {
                enviar(endereco, texto, semAcentos);
                responder(id, true, "Cupom enviado para a impressora");
            } catch (SecurityException e) {
                responder(id, false, "Sem permissão de Bluetooth.");
            } catch (Exception e) {
                responder(id, false, descrever(e));
            }
        });
    }

    /* ---------------- Impressão ---------------- */

    private void enviar(String endereco, String texto, boolean semAcentos) throws Exception {
        BluetoothAdapter adaptador = adaptador();
        if (adaptador == null) throw new IllegalStateException("Este aparelho não tem Bluetooth.");
        if (!adaptador.isEnabled()) throw new IllegalStateException("Ligue o Bluetooth do celular.");

        BluetoothDevice dispositivo = adaptador.getRemoteDevice(endereco);
        BluetoothSocket conexao = null;
        try {
            conexao = dispositivo.createRfcommSocketToServiceRecord(SPP);
            adaptador.cancelDiscovery();
            conexao.connect();

            try (OutputStream saida = conexao.getOutputStream()) {
                saida.write(new byte[]{0x1B, 0x40});             // reiniciar impressora
                saida.write(new byte[]{0x1B, 0x61, 0x00});       // alinhar à esquerda (o texto já vem centralizado)

                byte[] corpo;
                if (semAcentos) {
                    corpo = semAcento(texto).getBytes(Charset.forName("US-ASCII"));
                } else {
                    saida.write(new byte[]{0x1B, 0x74, 0x02});   // tabela CP850 (português)
                    corpo = texto.getBytes(Charset.forName("IBM850"));
                }
                saida.write(corpo);

                saida.write(new byte[]{0x1B, 0x64, 0x04});       // avançar 4 linhas para destacar o papel
                saida.write(new byte[]{0x1D, 0x56, 0x42, 0x00}); // cortar (impressora sem serrilha ignora)
                saida.flush();
                Thread.sleep(400);                               // dá tempo de escoar antes de fechar
            }
        } finally {
            if (conexao != null) {
                try { conexao.close(); } catch (Exception ignorado) { }
            }
        }
    }

    /** Remove acentos: a maioria das térmicas baratas não tem tabela para eles. */
    private static String semAcento(String texto) {
        String semMarcas = Normalizer.normalize(texto, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        return semMarcas.replace("ç", "c").replace("Ç", "C").replaceAll("[^\\p{ASCII}]", " ");
    }

    private static String descrever(Exception e) {
        String m = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
        if (m.contains("socket might closed") || m.contains("read failed") || m.contains("timeout")) {
            return "Não consegui falar com a impressora. Confira se ela está ligada e com papel.";
        }
        if (m.contains("refused") || m.contains("unable to connect")) {
            return "A impressora recusou a conexão. Desligue e ligue de novo, ou refaça o pareamento.";
        }
        return e.getMessage() == null ? "Falha ao imprimir." : e.getMessage();
    }

    /* ---------------- Apoio ---------------- */

    private BluetoothAdapter adaptador() {
        BluetoothManager gerente = (BluetoothManager) atividade.getSystemService(Context.BLUETOOTH_SERVICE);
        return gerente == null ? null : gerente.getAdapter();
    }

    private boolean temPermissao() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;   // antes do Android 12 basta o manifesto
        return ContextCompat.checkSelfPermission(atividade, Manifest.permission.BLUETOOTH_CONNECT)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void responder(String id, boolean ok, String mensagem) {
        String script = "window.__impressoraAndroid && window.__impressoraAndroid.resultado("
                + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(mensagem) + ")";
        principal.post(() -> webView.evaluateJavascript(script, null));
    }

    void encerrar() {
        fila.shutdownNow();
    }
}
