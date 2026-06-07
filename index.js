const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

const LOGIN_URL = "https://sisregiii.saude.gov.br/";
const CADWEB_URL = "https://sisregiii.saude.gov.br/cgi-bin/cadweb50";
const USER = "pontes.tatianesol";
const PASS_HASH = "30a7fc9ecc375787c8ab8a3350fd70018d9a60ed15f20271abef252b99f3bce1";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function getSessionCookie() {
    const data = new URLSearchParams({
        "usuario": USER,
        "senha": "",
        "senha_256": PASS_HASH,
        "etapa": "ACESSO",
        "logout": ""
    });

    const response = await axios.post(LOGIN_URL, data.toString(), {
        headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
        },
        timeout: 15000
    });

    const cookies = response.headers['set-cookie'];
    if (!cookies) throw new Error("Não foi possível obter cookies de sessão");
    return cookies.join('; ');
}

function extrairDados(html) {
    const $ = cheerio.load(html);
    const dados = { pessoais: {}, documentos: {}, endereco: {}, contatos: [], cadastro: {} };
    const trs = $("tr").get();

    for (let i = 0; i < trs.length; i++) {
        const tr = $(trs[i]);
        const texto = tr.text().replace(/\s+/g, ' ').trim();
        const nextCols = (i + 1 >= trs.length) ? [] : $(trs[i + 1]).find("td").get();

        if (texto.includes("CNS:") && nextCols.length > 0) dados.pessoais.cns = $(nextCols[0]).text().trim();
        else if (texto.includes("Nome:") && texto.includes("Nome Social") && nextCols.length >= 2) {
            dados.pessoais.nome = $(nextCols[0]).text().trim();
            dados.pessoais.nome_social = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Nome da M") && nextCols.length >= 2) {
            dados.pessoais.nome_mae = $(nextCols[0]).text().trim();
            dados.pessoais.nome_pai = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Sexo:") && texto.includes("Ra") && nextCols.length >= 2) {
            dados.pessoais.sexo = $(nextCols[0]).text().trim();
            dados.pessoais.raca = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Data de Nascimento:") && nextCols.length >= 2) {
            dados.pessoais.nascimento = $(nextCols[0]).text().trim();
            dados.pessoais.tipo_sanguineo = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Nacionalidade:") && nextCols.length >= 2) {
            dados.pessoais.nacionalidade = $(nextCols[0]).text().trim();
            dados.pessoais.municipio_nascimento = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Tipo Logradouro:") && nextCols.length >= 2) {
            dados.endereco.tipo_logradouro = $(nextCols[0]).text().trim();
            dados.endereco.logradouro = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Complemento:") && texto.includes("Número:") && nextCols.length >= 2) {
            dados.endereco.complemento = $(nextCols[0]).text().trim();
            dados.endereco.numero = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("Bairro:") && texto.includes("CEP:") && nextCols.length >= 2) {
            dados.endereco.bairro = $(nextCols[0]).text().trim();
            dados.endereco.cep = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("País de Residência:") && nextCols.length >= 2) {
            dados.endereco.pais = $(nextCols[0]).text().trim();
            dados.endereco.municipio = $(nextCols[1]).text().trim();
        }
        else if (texto.includes("CPF:") && nextCols.length > 0) dados.documentos.cpf = $(nextCols[0]).text().trim();
    }

    $(trs).each((i, el) => {
        const cols = $(el).find("td");
        if (cols.length === 3) {
            const tipo = $(cols[0]).text().trim();
            if (tipo === "CELULAR") {
                dados.contatos.push({ tipo, ddd: $(cols[1]).text().trim(), numero: $(cols[2]).text().trim() });
            }
        }
    });

    $(trs).each((i, el) => {
        const cols = $(el).find("td");
        if (cols.length === 4) {
            const rg = $(cols[0]).text().trim();
            if (/^\d+$/.test(rg)) {
                dados.documentos.rg = rg;
                dados.documentos.orgao_emissor = $(cols[1]).text().trim();
                dados.documentos.estado_emissor = $(cols[2]).text().trim();
                dados.documentos.data_emissao = $(cols[3]).text().trim();
                return false;
            }
        }
    });

    const bodyText = $("body").text();
    const qualidadeMatch = bodyText.match(/Grau de qualidade das informacoes:\s*(\d+%)/);
    if (qualidadeMatch) dados.cadastro.qualidade = qualidadeMatch[1];
    const atualizacaoMatch = bodyText.match(/Ultima atualizacao junto ao CADWEB:\s*([0-9/]+\s*@\s*[0-9:]+)/);
    if (atualizacaoMatch) dados.cadastro.ultima_atualizacao = atualizacaoMatch[1];

    return dados;
}

app.get("/consulta-cpf", async (req, res) => {
    try {
        const cpfRaw = req.query.cpf;
        if (!cpfRaw) return res.status(400).json({ erro: "CPF não informado" });

        const cpfClean = cpfRaw.replace(/\D/g, "");
        if (cpfClean.length !== 11) return res.status(400).json({ erro: "CPF inválido" });

        const cookie = await getSessionCookie();
        
        const payload = new URLSearchParams({
            "nu_cns": cpfClean, "nome_paciente": "", "nome_mae": "", "dt_nascimento": "",
            "uf_nasc": "", "mun_nasc": "", "uf_res": "", "mun_res": "", "sexo": "",
            "etapa": "DETALHAR", "url": "", "standalone": "1"
        });

        const response = await axios.post(CADWEB_URL + "?standalone=1", payload.toString(), {
            headers: {
                "User-Agent": USER_AGENT,
                "Cookie": cookie,
                "Origin": "https://sisregiii.saude.gov.br",
                "Referer": "https://sisregiii.saude.gov.br/cgi-bin/cadweb50?standalone=1",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 20000
        });

        const html = response.data;
        if (html.includes("Erro de sincronizacao")) return res.status(500).json({ erro: "Erro de sincronização do SISREG" });
        if (!html.includes("CONSULTA AO CADASTRO")) return res.status(500).json({ erro: "Paciente não encontrado" });

        return res.status(200).json(extrairDados(html));

    } catch (error) {
        return res.status(500).json({ erro: "Falha na execução", detalhes: error.message });
    }
});

// Rota inicial para testar se o servidor está vivo
app.get("/", (req, res) => res.send("Servidor de Consulta Ativo! Use /consulta-cpf?cpf=..."));

// PORTA DINÂMICA PARA RAILWAY
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
