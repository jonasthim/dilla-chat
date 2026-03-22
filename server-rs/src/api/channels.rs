use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::api::helpers::{json_ok, json_ok_true, require_permission, require_team_member, spawn_db};
use crate::api::AppState;
use crate::auth::UserId;
use crate::db;
use crate::error::AppError;

#[derive(Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(default)]
    pub topic: String,
    #[serde(rename = "type", default = "default_channel_type")]
    pub channel_type: String,
    #[serde(default)]
    pub category: String,
}

fn default_channel_type() -> String {
    "text".into()
}

#[derive(Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: Option<i32>,
    pub category: Option<String>,
}

pub async fn list(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let channels = spawn_db(state.db.clone(), move |conn| {
        require_team_member(conn, &user_id, &team_id)?;
        db::get_channels_by_team(conn, &team_id)
    })
    .await?;

    json_ok(channels)
}

pub async fn create(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<Value>, AppError> {
    if body.name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }

    let channel = spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_CHANNELS)?;

        let now = db::now_str();
        let channel = db::Channel {
            id: db::new_id(),
            team_id: team_id.clone(),
            name: body.name.clone(),
            topic: body.topic.clone(),
            channel_type: body.channel_type.clone(),
            position: 0,
            category: body.category.clone(),
            created_by: user_id.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        db::create_channel(conn, &channel)?;
        Ok(channel)
    })
    .await?;

    json_ok(channel)
}

pub async fn get_channel(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path((team_id, channel_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let channel = spawn_db(state.db.clone(), move |conn| {
        require_team_member(conn, &user_id, &team_id)?;
        get_channel_for_team(conn, &channel_id, &team_id)
    })
    .await
    .map_err(|e| match e {
        AppError::NotFound(_) => AppError::NotFound("channel not found".into()),
        other => other,
    })?;

    json_ok(channel)
}

pub async fn update(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path((team_id, channel_id)): Path<(String, String)>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<Json<Value>, AppError> {
    let channel = spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_CHANNELS)?;

        let mut channel = get_channel_for_team(conn, &channel_id, &team_id)?;
        apply_channel_updates(&mut channel, &body);
        db::update_channel(conn, &channel)?;
        Ok(channel)
    })
    .await
    .map_err(|e| match e {
        AppError::NotFound(_) => AppError::NotFound("channel not found".into()),
        other => other,
    })?;

    json_ok(channel)
}

/// Fetch a channel by ID and verify it belongs to the given team.
fn get_channel_for_team(
    conn: &rusqlite::Connection,
    channel_id: &str,
    team_id: &str,
) -> Result<db::Channel, rusqlite::Error> {
    let channel = db::get_channel_by_id(conn, channel_id)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

    if channel.team_id != team_id {
        return Err(rusqlite::Error::InvalidParameterName(
            "channel does not belong to this team".into(),
        ));
    }
    Ok(channel)
}

/// Apply optional update fields to a channel.
fn apply_channel_updates(channel: &mut db::Channel, body: &UpdateChannelRequest) {
    if let Some(ref name) = body.name {
        channel.name = name.clone();
    }
    if let Some(ref topic) = body.topic {
        channel.topic = topic.clone();
    }
    if let Some(pos) = body.position {
        channel.position = pos;
    }
    if let Some(ref cat) = body.category {
        channel.category = cat.clone();
    }
}

pub async fn delete_channel(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path((team_id, channel_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_MANAGE_CHANNELS)?;

        let channel = db::get_channel_by_id(conn, &channel_id)?;
        match channel {
            Some(ch) if ch.team_id == team_id => {
                db::delete_channel(conn, &channel_id)?;
                Ok(())
            }
            Some(_) => Err(rusqlite::Error::InvalidParameterName(
                "channel does not belong to this team".into(),
            )),
            None => Err(rusqlite::Error::QueryReturnedNoRows),
        }
    })
    .await
    .map_err(|e| match e {
        AppError::NotFound(_) => AppError::NotFound("channel not found".into()),
        other => other,
    })?;

    json_ok_true()
}
