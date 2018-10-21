import Discord, { Message, TextChannel, MessageOptions } from 'discord.js'
import axiosLib from 'axios'
const client = new Discord.Client()
const CommandPrefix = process.env.CMD_PREFIX || ','
const ClientId = process.env.CLIENT_ID
const SourceChannelId = process.env.SOURCE_CHANNEL_ID!
const Admins: string[] = process.env.ADMINS ? JSON.parse(process.env.ADMINS) : []
const TypingTimeout = 200
const ListTimeout = 300
const FetchAllInterval = 300
const AxiosTimeout = 20
const axios = axiosLib.create({
  timeout: AxiosTimeout * 1000,
  headers: {
    'User-Agent': 'Switch-Lan-Play Server List Bot/1.0'
  }
})

if (!SourceChannelId) {
  console.error('SourceChannelId is not set')
  process.exit(1)
}

interface LanPlayServer {
  id: number
  address: string
  region: string
}
interface ServerInfoCache {
  ok: boolean
  reason: string
  online: number
  version: string
  timestamp: Date
  server: LanPlayServer
}
interface ServerInfo {
  online: number
  version: string
}

class ServerListBot {
  client: Discord.Client
  serverList: Map<number, LanPlayServer> = new Map()
  serverInfo: Map<number, ServerInfoCache> = new Map()
  lastFetch: Date = new Date()

  constructor (client: Discord.Client) {
    this.client = client
    this.client.on('message', async msg => {
      try {
        if (isTextChannel(msg.channel)) {
          await this.typing(msg.channel, this.onMessage(msg))
        } else {
          await this.onMessage(msg)
        }
      } catch (e) {
        msg.reply(`Error: ${e.message}`)
      }
    })
    setInterval(() => this.fetchAll(), FetchAllInterval * 1000)
    this.init()
  }
  async init () {
    await this.loadList()
  }
  async onMessage (msg: Message) {
    if (msg.content.startsWith(CommandPrefix)) {
      const content = msg.content.substr(CommandPrefix.length)
      if (Admins.includes(msg.author.id)) {
        return await this.onAdmin(content, msg)
      }
      return await this.onCommand(content, msg)
    }
  }
  async onCommand (content: string, msg: Message) {
    const args = content.split(' ')
    if (content === 'help') {
      const help = [
        `server <1,2,3,4,5...<#${SourceChannelId}>>`,
        'list',
        'help'
      ]
      const embed = new Discord.RichEmbed()
        .setColor('#FFFF00')
        .addField(`Prefix: ${CommandPrefix}`, help.map(i => `${CommandPrefix}${i}`).join('\n'))
      msg.channel.send({
        embed
      })
    } else if (args[0] === 'server') {
      let [_, idStr] = args
      const id = parseInt(idStr)
      const server = this.serverList.get(id)
      if (id === NaN || !server) {
        msg.reply(`bad server id`)
        return
      }
      const info = await axios.get<ServerInfo>(`http://${server.address}/info`)
      const embed = new Discord.RichEmbed()
        .setColor('#00FF00')
        .addField(server.address, `Online: ${info.data.online}`)
      msg.channel.send({
        embed
      })
    } else if (content === 'list') {
      const embed = new Discord.RichEmbed()
      .setColor('#00FF00')
      .setDescription(this.getList())
      .setTimestamp(this.lastFetch)
      .setFooter(`This message will be deleted after ${ListTimeout} seconds`, `https://brandmark.io/intro/info.png`)
      const msgOpt: MessageOptions = {
        embed
      }
      const sent = await msg.channel.send(msgOpt)
      if (Array.isArray(sent)) {
        for (let s of sent) {
          s.delete(ListTimeout * 1000)
        }
      } else {
        sent.delete(ListTimeout * 1000)
      }
    } else if (content === 'role') {
      msg.reply('member')
    }
  }
  async onAdmin (content: string, msg: Message) {
    if (content === 'refresh') {
      const warnings = await this.loadList()
      let warning = warnings.join('\n')
      msg.reply(`Refresh done${warning.length > 0 ? `\n${warning}` : ''}`)
    } if (content === 'role') {
      msg.reply('admin')
    } else {
      return await this.onCommand(content, msg)
    }
  }
  async loadList () {
    const channel = this.client.channels.get(SourceChannelId)
    const newList = new Map<number, LanPlayServer>()
    if (channel === undefined) {
      throw new Error(`Source channel is not found`)
    }
    if (isTextChannel(channel)) {
      const msgs = await channel.fetchPinnedMessages()
      const msg = msgs.last()
      const content = msg.content
      let re = /(\d+)\)\s*([0-9a-zA-Z:\-\.]+)\s*(.*?)\s*$/mg
      let result: RegExpExecArray | null
      let warning: string[] = []
      while (result = re.exec(content)) {
        const [_, idStr, address, region] = result
        const id = parseInt(idStr)
        if (newList.has(id)) {
          warning.push(`duplicate server id`)
        }
        newList.set(id, {
          id,
          address,
          region
        })
      }
      if (newList.size === 0) {
        warning.push(`no server detected from source channel, check the format`)
      }
      this.serverList = newList
      this.serverInfo = new Map()
      this.fetchAll()
      return warning
    } else {
      throw new Error(`Source channel is text channel`)
    }
  }
  async fetchAll () {
    console.log('fetchAll start')
    let all: Promise<void>[] = []
    for (let [id, server] of this.serverList) {
      all.push((async () => {
        try {
          const info = (await axios.get<ServerInfo>(`http://${server.address}/info`)).data
          this.serverInfo.set(id, {
            ok: true,
            reason: '',
            online: info.online,
            version: info.version,
            timestamp: new Date(),
            server
          })
        } catch (e) {
          this.serverInfo.set(id, {
            ok: false,
            reason: e.message,
            online: -1,
            version: 'unknown',
            timestamp: new Date(),
            server
          })
        }
      })())
    }
    await Promise.all(all)
    this.lastFetch = new Date()
    console.log('fetchAll done')
  }
  async typing<T> (channel: TextChannel, p: Promise<T>) {
    let id = setTimeout(() => {
      channel.startTyping()
    }, TypingTimeout)
    const r = await p
    channel.stopTyping()
    clearTimeout(id)
    return r
  }
  getList () {
    let out: {
      id: number,
      text: string
    }[] = []
    for (let [id, value] of this.serverList) {
      let info = this.serverInfo.get(id)
      let online: string
      if (info) {
        if (info.ok) {
          online = info.online.toString()
        } else {
          online = info.reason
        }
      } else {
        online = 'fetching...'
      }
      out.push({
        id,
        text: `${id}) ${value.address} ${value.region} :busts_in_silhouette: ${online}`
      })
    }
    return out.sort((a, b) => a.id - b.id).map(i => i.text).join('\n')
  }
}

async function main () {
  await client.login(process.env.BOT_TOKEN)
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${ClientId}&permissions=0&scope=bot`)
  const serverList = new ServerListBot(client)
}

main().catch(e => console.error(e))

function isTextChannel (channel: Discord.Channel): channel is Discord.TextChannel {
  return channel.type === 'text'
}