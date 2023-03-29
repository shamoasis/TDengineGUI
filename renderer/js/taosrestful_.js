const axios = require('axios')
const { formatResult } = require('./versionAdapter')

module.exports = {
    async sendRequest(sqlStr, payload) {
        // console.log(sqlStr)
        try {
            if (!payload.timeout) {
                payload.timeout = 10000;
            }
            let res = await axios.post(`http://${payload.ip}:${payload.port}/rest/sql`, sqlStr, {
                auth: {
                    username: payload.user,
                    password: payload.password
                },
                timeout: payload.timeout
            })

            res = formatResult(res, sqlStr)

            if (res.data.status === 'succ') {
                // console.log(res.data.data)
                // console.log(res.data.rows)
                // console.log(res.data.head)
                let head = res.data.head
                let resData = res.data.data.map(item => Object.fromEntries(head.map((a, b) => [a, item[b]])))
                return {'res': true, 'count': res.data.rows, 'data': resData}
            } else {
                return {'res': false, 'msg': res.data.desc, 'code': res.data.code}
            }
        } catch (err) {
            if (err.response) {
                return {'res': false, 'msg': err.response.data.desc, 'code': err.response.data.code}
            } else {
                return {'res': false, 'msg': '连接错误', 'code': -1}
            }
        }

    },
    showDatabases(payload) {
        return this.sendRequest('SHOW DATABASES', payload)
    },
    testConnect(payload) {
        return this.sendRequest('SELECT SERVER_VERSION()', payload).then(a => {
                return !(a.res === false && a.code === -1);
            }
        )
    },
    getVersion(payload) {
        //获取服务器版本
        return this.sendRequest('SELECT SERVER_VERSION()', payload).then(a => {
            return a.res === false ? 'unkown' : a.data[0]['server_version()'];
            }
        )
    },
    //添加数据库
    createDatabase(dbName, payload, safe = true, keep = null, update = 0, comp = null,
                   replica = null, quorum = null, blocks = null, version) {
        let sqlStr = 'CREATE DATABASE '
        if (safe) {
            sqlStr += 'IF NOT EXISTS '
        }
        sqlStr += dbName

        if (keep) {
            sqlStr += ` KEEP ${keep}`
        }
        if (comp) {
            sqlStr += ` COMP ${comp}`
        }
        if (replica) {
            sqlStr += ` REPLICA ${replica}`
        }
        if (quorum) {
            sqlStr += ` QUORUM ${quorum}`
        }
        if (blocks) {
            sqlStr += ` BLOCKS ${blocks}`
        }
        if (update) {
            if (this.compareVersion(version, '2.0.8.0')) {
                if (update == 2) {
                    if (this.compareVersion(version, '2.1.7.0')) {
                        sqlStr += ` UPDATE ${update}`
                    } else {
                        console.log("update参数暂不支持：" + version + "版本")
                    }
                } else {
                    sqlStr += ` UPDATE ${update}`
                }
            } else {
                console.log("update参数暂不支持：" + version + "版本")
            }
        }
        return this.sendRequest(sqlStr, payload)
    },
// alterDatabase(dbName,keep=null,comp=null,replica=null,quorum=null,blocks=null){
//         let sqlStr = 'ALTER DATABASE '
//         sqlStr += dbName
//         if(keep != null){
//             sqlStr += ` KEEP ${keep}`
//         }
//         if(comp != null){
//             sqlStr += ` COMP ${comp}`
//         }
//         if(replica != null){
//             sqlStr += ` REPLICA ${replica}`
//         }
//         if(quorum != null){
//             sqlStr += ` QUORUM ${quorum}`
//         }
//         if(blocks != null){
//             sqlStr += ` BLOCKS ${blocks}`
//         }
//         // console.log(sqlStr)
//         return this.sendRequest(sqlStr)
//     },
//    useDatabase(dbName){
//     this.database = dbName
//    },
    dropDatabase(dbName, payload, safe = true) {
        return this.sendRequest(`DROP DATABASE ${safe ? 'IF EXISTS' : ''} ${dbName}`, payload)
    },
    showSuperTables(dbName, payload, like = null) {
        let likeStr = like ? ` LIKE '%${like}%'` : ''
        return this.sendRequest(`SHOW ${dbName}.STABLES  ${likeStr}`, payload)
    },
    showTables(dbName, payload, like = null) {
        let likeStr = like ? ` LIKE '%${like}%'` : ''
        return this.sendRequest(`SHOW ${dbName}.TABLES  ${likeStr}`, payload)
    },
    disTable(tableName, dbName, payload) {
        return this.sendRequest(`DESCRIBE ${dbName}.\`${tableName}\``, payload)
    },
    dropTable(tableName, dbName, payload, safe = false) {
        return this.sendRequest(`DROP TABLE ${safe?'IF EXISTS':''} ${dbName}.\`${tableName}\``, payload)
    },
    insertData(tableName, data, dbName = null) {
        let dbN = dbName ? dbName : this.database
        let fields = ''
        let values = ''
        for (const [key, value] of Object.entries(data)) {
            fields += key + ','
            values += value + ','
        }
        // console.log(`INSERT INTO ${dbN}.${tableName} (${fields.slice(0,-1)}) VALUES (${values.slice(0,-1)})` )
        return this.sendRequest(`INSERT INTO ${dbN}.\`${tableName}\` (${fields.slice(0,-1)}) VALUES (${values.slice(0,-1)})`)
    },
    timeWhere(primaryKey, where, startTime, endTime) {
        where = where || ''
        if (where) {
            where += startTime ? ` and ${primaryKey} > '${startTime}' ` : ''
            if (where) {
                where += endTime ? ` and ${primaryKey} < '${endTime}' ` : ''
            } else {
                where += endTime ? `${primaryKey} < '${endTime}' ` : ''
            }
        } else {
            where += startTime ? `${primaryKey} > '${startTime}' ` : ''
            if (where) {
                where += endTime ? ` and ${primaryKey} < '${endTime}' ` : ''
            } else {
                where += endTime ? `${primaryKey} < '${endTime}' ` : ''
            }
        }
        return where
    },
    //查询数据
    selectData(tableName, dbName, payload, fields = null, where = null, limit = null,
               offset = null, desc = null, startTime = null, endTime = null) {
        //首先查询一次，获取表的整体情况
        return this.disTable(tableName, dbName, payload).then(res => {
            let primaryKey = 'ts'
            if (res.res && res.data.length > 0) {
                //获取第一项，时间戳
                primaryKey = res.data[0].Field
            } else {
                return {'res': false, 'msg': 'distable error', 'code': 99}
            }

            primaryKey=primaryKey==null?"_ts":primaryKey;
            //组装where子句  //TODO
            where = this.timeWhere(primaryKey, where, startTime, endTime)
            let sqlStr = 'SELECT '
            let fieldStr = '*'
            if (fields && fields.length > 0) {
                fieldStr = ''
                fields.forEach(function (field) {
                    fieldStr +="`"+ field + '`,'
                });
                fieldStr = fieldStr.slice(0, -1)
            }
            sqlStr += fieldStr + ` FROM ${dbName}.\`${tableName}\` `
            if (where) {
                sqlStr += ` WHERE ${where} `
            }
            if (desc === 'DESC') {
                sqlStr += ` ORDER BY ${primaryKey} ${desc} `
            }

            if (limit != null) {
                sqlStr += ` LIMIT ${limit} `
            }
            if (offset != null) {
                sqlStr += ` OFFSET ${offset} `
            }

            //把总数数出来
            if (limit != null) {
                return this.sendRequest(sqlStr, payload).then(res => {
                    return this.countDataIn(tableName, dbName, primaryKey, payload, where).then(count => {
                        res.count = count
                        return new Promise((resolve, reject) => {
                            resolve(res)
                        })
                    })
                })
            } else {
                return this.sendRequest(sqlStr, payload)
            }

        })

    },
    countDataIn(tableName, dbName, primaryKey, payload, where = '', startTime = null, endTime = null) {
        where = this.timeWhere(primaryKey, where, startTime, endTime)
        let sqlStr = 'SELECT '
        let fieldStr = 'count(*)'
        sqlStr += fieldStr + ` FROM ${dbName}.\`${tableName}\` `
        if (where) {
            sqlStr += ` WHERE ${where} `
        }
        // console.log(sqlStr)
        return this.sendRequest(sqlStr, payload).then(result => {
            if (result.res && result.data.length > 0) {
                return new Promise((resolve, reject) => {
                    resolve(result.data[0]['count(*)'])
                })
            } else {
                return new Promise((resolve, reject) => {
                    resolve(0)
                })
            }
        })
    },
    rawSql(sqlStr, payload) {
        return this.sendRequest(sqlStr, payload)
    },
    compareVersion(serverVersion, targetVersion) {
        if (serverVersion == targetVersion) {
            return true;
        }
        let serverArray = serverVersion.split(".");
        let targetArray = targetVersion.split(".");
        let length = Math.min(serverArray.length, targetArray.length);
        for (let i = 0; i < length; i++) {
            if (serverArray[i] > targetArray[i]) {
                return true;
            } else if (serverArray[i] < targetArray[i]) {
                return false;
            }
        }
        return false;
    }
}

